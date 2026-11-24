---
description: "@heimdallfund/sdk wraps the API and contracts for agents written in TypeScript. Built on viem."
---

# TypeScript SDK

```bash
npm install @heimdallfund/sdk viem
```

## API

| Export | Use |
| --- | --- |
| `new HeimdallShield({ apiKey, baseUrl })` | Client for the Shield API: `check(tx, policy)`, `signer()`. |
| `guardedSend(wallet, tx, { shield, policy, allowWarn })` | Checks, then sends only on ALLOW (or WARN if allowed). Throws `HeimdallDenied`. |
| `executeThroughVault(wallet, { vault, target, data }, { shield })` | Manager flow: Shield check as the vault, then `vault.execute` with the receipt. |
| `receiptArgs(receipt)` | Converts an API receipt into `execute()` arguments. |
| `signVoucher(wallet, { chainId, signals, signalId, cumulativeAmount })` | Signs a cumulative Signals voucher. |
| `encodeVoucherHeader` / `decodeVoucherHeader` | `x-heimdall-voucher` header encoding. |
| `verifyVoucher(client, …)` | Provider-side voucher check against the payer's available balance and claims. |
| `gateVoucher(config, header)` / `MemoryLedger` | 402 payment gate for signal endpoints. |
| `heimdallVaultAbi`, `heimdallVaultFactoryAbi`, `heimdallSignalsAbi` | Contract ABIs. |
| `robinhoodChain`, `USDG` | Chain definition and the USDG address. |

## Example: manager agent

```ts
import { HeimdallShield, executeThroughVault, HeimdallDenied } from "@heimdallfund/sdk";

const shield = new HeimdallShield({ apiKey: process.env.HEIMDALL_API_KEY });
try {
  const { hash, result } = await executeThroughVault(manager, { vault, target: router, data: swap }, { shield, policy: { strict: true } });
  console.log("traded", hash, result.summary);
} catch (e) {
  if (e instanceof HeimdallDenied) console.log("Shield said no:", e.result.findings);
}
```

## Integrations

| Function | What it does |
| --- | --- |
| `payX402(fetch, wallet, { maxAmount })` | A fetch that pays x402 402s in USDG, up to your cap per call ([x402](../integrate/x402.md)) |
| `shield.risk(address)` / `readRisk(client, oracle, address)` | Risk level from the API, or straight from the onchain Risk Oracle ([Risk Oracle](../integrate/risk-oracle.md)) |
| `guardSetupCalls(safe, setup)` / `safeBatch(...)` | The Safe transactions that enable Heimdall Guard for an agent ([Guard](../integrate/guard.md)) |
| `executeThroughGuard(wallet, { module, safe, to, data }, { shield })` | Run an agent call through the Guard module with a Shield receipt |
| `shield.passport(id)` / `shield.linkPassport(address, agentId)` | Agent Passport and ERC-8004 linking ([Passport](../integrate/passport.md)) |
| `heimdallScore(client, agentId, publisher)` | Heimdall's score straight from the ERC-8004 Reputation Registry |

## Python

For agents written in Python (LangChain, CrewAI, plain scripts): `heimdallfund`, sync and async, typed.

```bash
pip install heimdallfund
```

```python
from heimdallfund import Shield, HeimdallDenied

shield = Shield()  # free tier; Shield(api_key=...) or HEIMDALL_API_KEY lifts the limit
try:
    shield.guard(sender=agent, to=target, data=calldata, value=0)  # raises unless ALLOW
    send_transaction(...)
except HeimdallDenied as e:
    print(e.result["findings"])
```

`check`, `guard`, `check_signature`, `risk`, `wallet_check`, `threats`, `passport`, `agent` and `status`; `AsyncShield` has the same methods. Over the free tier the client raises `PaymentRequired` with the x402 requirements.
