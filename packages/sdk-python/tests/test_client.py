import json

import httpx
import pytest

from heimdallfund import AsyncShield, HeimdallDenied, HeimdallError, PaymentRequired, Shield, require_allow

AGENT = "0x1111111111111111111111111111111111111111"
USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
DENY = {"checkId": "0x01", "verdict": "DENY", "riskScore": 95, "summary": [], "findings": [{"code": "BLOCKLISTED_SPENDER", "severity": "deny", "message": "Known drainer."}], "approvals": [], "assetChanges": [], "simulation": {"ok": True, "available": True}}


def recorder(status=200, body=None, headers=None):
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(status, json=body if body is not None else DENY, headers=headers or {})

    return handler, seen


def test_check_sends_the_transaction_and_returns_the_verdict():
    handler, seen = recorder()
    s = Shield(api_key="hd_live_test", transport=httpx.MockTransport(handler))
    r = s.check(AGENT, USDG, "0x095ea7b3", value=10**18, policy={"strict": True})
    assert r["verdict"] == "DENY"
    req = seen[0]
    assert req.url.path == "/v1/check"
    assert req.headers["authorization"] == "Bearer hd_live_test"
    assert json.loads(req.content) == {"chainId": 4663, "from": AGENT, "to": USDG, "data": "0x095ea7b3", "value": "1000000000000000000", "policy": {"strict": True}}


def test_guard_fails_closed_on_deny_and_lets_warn_through_only_when_asked():
    handler, _ = recorder()
    with pytest.raises(HeimdallDenied, match="DENY: Known drainer"):
        Shield(transport=httpx.MockTransport(handler)).guard(AGENT, USDG)
    warn = dict(DENY, verdict="WARN", findings=[{"code": "UNLIMITED_APPROVAL", "severity": "warn", "message": "Unlimited."}])
    require_allow(warn, allow_warn=True)
    with pytest.raises(HeimdallDenied):
        require_allow(warn)


def test_signature_needs_exactly_one_payload():
    handler, seen = recorder(body={"verdict": "ALLOW", "riskScore": 0, "kind": "personal_sign", "summary": [], "findings": [], "approvals": []})
    s = Shield(transport=httpx.MockTransport(handler))
    assert s.check_signature(AGENT, message="Sign in")["verdict"] == "ALLOW"
    assert json.loads(seen[0].content)["message"] == "Sign in"
    with pytest.raises(ValueError):
        s.check_signature(AGENT)
    with pytest.raises(ValueError):
        s.check_signature(AGENT, typed_data={"primaryType": "Permit", "message": {}}, message="x")
    s.check_signature(AGENT, authorization={"chainId": 4663, "address": USDG, "nonce": 1})
    assert json.loads(seen[-1].content)["authorization"] == {"chainId": 4663, "address": USDG, "nonce": 1}


def test_payment_required_and_errors_carry_the_details():
    handler, _ = recorder(402, {"error": "payment_required"}, {"payment-required": "eyJ4In0="})
    with pytest.raises(PaymentRequired) as e:
        Shield(transport=httpx.MockTransport(handler)).check(AGENT, USDG)
    assert e.value.requirements == "eyJ4In0=" and e.value.status == 402
    handler, _ = recorder(400, {"error": "invalid_request"})
    with pytest.raises(HeimdallError, match="400"):
        Shield(transport=httpx.MockTransport(handler)).risk("nope")


def test_reads_key_and_url_from_the_environment(monkeypatch):
    monkeypatch.setenv("HEIMDALL_API_KEY", "hd_env")
    monkeypatch.setenv("HEIMDALL_API_URL", "https://shield.example/")
    handler, seen = recorder(body={"ok": True})
    Shield(transport=httpx.MockTransport(handler)).status()
    assert str(seen[0].url) == "https://shield.example/v1/status"
    assert seen[0].headers["authorization"] == "Bearer hd_env"


async def test_async_client_matches_the_sync_one():
    handler, seen = recorder()
    async with AsyncShield(transport=httpx.MockTransport(handler)) as s:
        r = await s.check(AGENT, USDG)
        assert r["verdict"] == "DENY"
        with pytest.raises(HeimdallDenied):
            await s.guard(AGENT, USDG)
    assert seen[0].url.path == "/v1/check"


def test_radar_summary_and_accuracy_hit_their_paths():
    handler, seen = recorder(body={"tokens": []})
    s = Shield(transport=httpx.MockTransport(handler))
    s.radar()
    s.token_summary(USDG)
    s.accuracy()
    assert [r.url.path for r in seen] == ["/v1/radar", f"/v1/token/{USDG}/summary", "/v1/bench"]
