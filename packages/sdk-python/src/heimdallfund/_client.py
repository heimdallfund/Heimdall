from __future__ import annotations

import os
from typing import Any, Mapping

import httpx

from ._errors import HeimdallDenied, HeimdallError, PaymentRequired
from ._types import CheckResult, Policy, RiskReport, SignatureCheckResult

DEFAULT_URL = "https://api.heimdall.fund"
ROBINHOOD_CHAIN = 4663
USER_AGENT = "heimdallfund-python/0.2.0"


def _tx_body(sender: str, to: str | None, data: str, value: int | str, chain_id: int, policy: Policy | None, share: bool, probe: bool) -> dict[str, Any]:
    body: dict[str, Any] = {"chainId": chain_id, "from": sender, "to": to, "data": data or "0x", "value": str(int(value)) if not isinstance(value, str) else value}
    if policy:
        body["policy"] = dict(policy)
    if share:
        body["share"] = True
    if probe:
        body["probe"] = True
    return body


def _sig_body(signer: str, typed_data: Mapping[str, Any] | None, message: str | None, chain_id: int, policy: Policy | None, share: bool, authorization: Mapping[str, Any] | None = None) -> dict[str, Any]:
    if sum(x is not None for x in (typed_data, message, authorization)) != 1:
        raise ValueError("pass exactly one of typed_data, message or authorization")
    body: dict[str, Any] = {"chainId": chain_id, "signer": signer}
    if typed_data is not None:
        body["typedData"] = dict(typed_data)
    elif authorization is not None:
        body["authorization"] = dict(authorization)
    else:
        body["message"] = message
    if policy:
        body["policy"] = dict(policy)
    if share:
        body["share"] = True
    return body


def _parse(res: httpx.Response) -> Any:
    try:
        body = res.json()
    except ValueError:
        body = None
    if res.status_code == 402:
        raise PaymentRequired(body, res.headers.get("payment-required"))
    if res.status_code >= 400:
        msg = body.get("message") or body.get("error") if isinstance(body, dict) else None
        raise HeimdallError(f"Shield request failed ({res.status_code}){f': {msg}' if msg else ''}", res.status_code, body)
    return body


def require_allow(result: Mapping[str, Any], allow_warn: bool = False) -> None:
    """Raise HeimdallDenied unless the verdict is ALLOW (or WARN, when allow_warn is set)."""
    if result.get("verdict") == "ALLOW" or (allow_warn and result.get("verdict") == "WARN"):
        return
    raise HeimdallDenied(result)


class _Base:
    def __init__(self, api_key: str | None = None, base_url: str | None = None, timeout: float = 20.0, chain_id: int = ROBINHOOD_CHAIN) -> None:
        self.base_url = (base_url or os.environ.get("HEIMDALL_API_URL") or DEFAULT_URL).rstrip("/")
        self.chain_id = chain_id
        self.timeout = timeout
        key = api_key if api_key is not None else os.environ.get("HEIMDALL_API_KEY")
        self._headers = {"user-agent": USER_AGENT, "content-type": "application/json"}
        if key:
            self._headers["authorization"] = f"Bearer {key}"


class Shield(_Base):
    """Synchronous client. Without an API key the free tier applies to your IP."""

    def __init__(self, api_key: str | None = None, base_url: str | None = None, timeout: float = 20.0, chain_id: int = ROBINHOOD_CHAIN, transport: httpx.BaseTransport | None = None) -> None:
        super().__init__(api_key, base_url, timeout, chain_id)
        self._http = httpx.Client(base_url=self.base_url, headers=self._headers, timeout=timeout, transport=transport)

    def __enter__(self) -> "Shield":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    def _get(self, path: str) -> Any:
        return _parse(self._http.get(path))

    def _post(self, path: str, body: Mapping[str, Any]) -> Any:
        return _parse(self._http.post(path, json=body))

    def check(self, sender: str, to: str | None, data: str = "0x", value: int | str = 0, policy: Policy | None = None, share: bool = False, probe: bool = False) -> CheckResult:
        """Simulate a transaction on the current chain state and judge it: ALLOW, WARN or DENY with the reasons."""
        return self._post("/v1/check", _tx_body(sender, to, data, value, self.chain_id, policy, share, probe))

    def check_signature(self, signer: str, typed_data: Mapping[str, Any] | None = None, message: str | None = None, policy: Policy | None = None, share: bool = False, authorization: Mapping[str, Any] | None = None) -> SignatureCheckResult:
        """Judge an EIP-712 request (Permit, Permit2, orders), a personal_sign message, or an EIP-7702 authorization
        ({"chainId": 4663, "address": delegate, "nonce": n}) before signing it."""
        return self._post("/v1/check-signature", _sig_body(signer, typed_data, message, self.chain_id, policy, share, authorization))

    def guard(self, sender: str, to: str | None, data: str = "0x", value: int | str = 0, policy: Policy | None = None, allow_warn: bool = False) -> CheckResult:
        """Check, then raise HeimdallDenied unless the verdict allows signing. Errors raise too: fail closed."""
        result = self.check(sender, to, data, value, policy)
        require_allow(result, allow_warn)
        return result

    def token_check(self, token: str) -> dict[str, Any]:
        """Token Check: simulated buy, sell and transfer through the token's Uniswap pool, taxes, clawbacks, fake tickers."""
        return self._get(f"/v1/token/{token}")

    def risk(self, address: str) -> RiskReport:
        """Risk level and flags of an address, as the Risk Oracle holds them."""
        return self._get(f"/v1/risk/{address}")

    def threats(self) -> dict[str, Any]:
        """Threat Board: patterns Shield is catching, most denied addresses and the sourced blocklist."""
        return self._get("/v1/threats")

    def wallet_check(self, address: str, refresh: bool = False) -> dict[str, Any]:
        """Every live token approval of a wallet, ranked by risk."""
        return self._get(f"/v1/wallet/{address}{'?refresh=1' if refresh else ''}")

    def verdict(self, share_id: str) -> dict[str, Any]:
        """A verdict saved with share=True."""
        return self._get(f"/v1/verdicts/{share_id}")

    def passport(self, agent: str | int) -> dict[str, Any]:
        """Agent Passport by wallet address or ERC-8004 agent ID."""
        return self._get(f"/v1/passport/{agent}")

    def agent(self, address: str) -> dict[str, Any]:
        """Public check history of an agent wallet."""
        return self._get(f"/v1/agents/{address}")

    def status(self) -> dict[str, Any]:
        """Live service status."""
        return self._get("/v1/status")


class AsyncShield(_Base):
    """Async client with the same methods as Shield."""

    def __init__(self, api_key: str | None = None, base_url: str | None = None, timeout: float = 20.0, chain_id: int = ROBINHOOD_CHAIN, transport: httpx.AsyncBaseTransport | None = None) -> None:
        super().__init__(api_key, base_url, timeout, chain_id)
        self._http = httpx.AsyncClient(base_url=self.base_url, headers=self._headers, timeout=timeout, transport=transport)

    async def __aenter__(self) -> "AsyncShield":
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _get(self, path: str) -> Any:
        return _parse(await self._http.get(path))

    async def _post(self, path: str, body: Mapping[str, Any]) -> Any:
        return _parse(await self._http.post(path, json=body))

    async def check(self, sender: str, to: str | None, data: str = "0x", value: int | str = 0, policy: Policy | None = None, share: bool = False, probe: bool = False) -> CheckResult:
        return await self._post("/v1/check", _tx_body(sender, to, data, value, self.chain_id, policy, share, probe))

    async def check_signature(self, signer: str, typed_data: Mapping[str, Any] | None = None, message: str | None = None, policy: Policy | None = None, share: bool = False, authorization: Mapping[str, Any] | None = None) -> SignatureCheckResult:
        return await self._post("/v1/check-signature", _sig_body(signer, typed_data, message, self.chain_id, policy, share, authorization))

    async def guard(self, sender: str, to: str | None, data: str = "0x", value: int | str = 0, policy: Policy | None = None, allow_warn: bool = False) -> CheckResult:
        result = await self.check(sender, to, data, value, policy)
        require_allow(result, allow_warn)
        return result

    async def token_check(self, token: str) -> dict[str, Any]:
        return await self._get(f"/v1/token/{token}")

    async def risk(self, address: str) -> RiskReport:
        return await self._get(f"/v1/risk/{address}")

    async def threats(self) -> dict[str, Any]:
        return await self._get("/v1/threats")

    async def wallet_check(self, address: str, refresh: bool = False) -> dict[str, Any]:
        return await self._get(f"/v1/wallet/{address}{'?refresh=1' if refresh else ''}")

    async def verdict(self, share_id: str) -> dict[str, Any]:
        return await self._get(f"/v1/verdicts/{share_id}")

    async def passport(self, agent: str | int) -> dict[str, Any]:
        return await self._get(f"/v1/passport/{agent}")

    async def agent(self, address: str) -> dict[str, Any]:
        return await self._get(f"/v1/agents/{address}")

    async def status(self) -> dict[str, Any]:
        return await self._get("/v1/status")
