# heimdallfund

Heimdall Shield for Python. Before your agent signs a transaction or a signature on Robinhood Chain, Shield simulates it on the current chain state and answers **ALLOW**, **WARN** or **DENY** with the reasons: drainer approvals, honeypots, vanishing and fake tokens, address poisoning, blocklisted addresses, reverts and your own spend limits.

```bash
pip install heimdallfund
```

## Check, then sign

```python
from heimdallfund import Shield, HeimdallDenied

shield = Shield()  # free tier; Shield(api_key="hd_live_…") or HEIMDALL_API_KEY lifts the limit

result = shield.check(
    sender="0xYourAgentWallet",
    to="0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",  # USDG
    data="0x095ea7b3…",                               # the calldata you are about to sign
    value=0,
    policy={"maxNativeOut": str(10**17), "denyUnlimitedApprovals": True},
)
print(result["verdict"], [f["message"] for f in result["findings"]])
```

`guard()` does the same and raises `HeimdallDenied` unless the verdict is ALLOW, so a refused or failed check never reaches your signer:

```python
try:
    shield.guard(sender, to, data, value)
    send_transaction(...)
except HeimdallDenied as e:
    tell_the_user(e.result["findings"])
```

## Signatures

```python
shield.check_signature(signer, typed_data=permit_request)   # EIP-712: Permit, Permit2, orders
shield.check_signature(signer, message="Sign in to example.com")
```

## Lookups

```python
shield.risk("0x…")         # risk level and flags from the Risk Oracle list
shield.wallet_check("0x…") # every live approval of a wallet, ranked
shield.threats()           # what Shield is catching, and the sourced blocklist
shield.passport("0x…")     # ERC-8004 agent passport and score
```

## Async

```python
from heimdallfund import AsyncShield

async with AsyncShield() as shield:
    result = await shield.check(sender, to, data, value)
```

## Limits and payment

Without a key, the free tier applies to your IP. Above it Shield answers 402 and the client raises `PaymentRequired` with the x402 requirements: pay per call in USDG, or use an API key from [heimdall.fund/app/keys](https://heimdall.fund/app/keys).

Rules for agents: never sign on DENY; on WARN, ask the user; if the check fails, treat the transaction as unsafe.

Docs: [heimdall.fund/docs](https://heimdall.fund/docs) · API reference: [heimdall.fund/docs/api](https://heimdall.fund/docs/api) · License: BUSL 1.1
