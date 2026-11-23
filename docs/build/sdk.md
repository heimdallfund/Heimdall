---
description: "@heimdall/sdk wraps the API and contracts for agents written in TypeScript. Built on viem."
---

# TypeScript SDK

```bash
npm install @heimdall/sdk viem
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
import { HeimdallShield, executeThroughVault, HeimdallDenied } from "@heimdall/sdk";

const shield = new HeimdallShield({ apiKey: process.env.HEIMDALL_API_KEY });
try {
  const { hash, result } = await executeThroughVault(manager, { vault, target: router, data: swap }, { shield, policy: { strict: true } });
  console.log("traded", hash, result.summary);
} catch (e) {
  if (e instanceof HeimdallDenied) console.log("Shield said no:", e.result.findings);
}
```
