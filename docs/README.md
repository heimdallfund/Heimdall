---
description: >-
  Heimdall is the guardian layer for onchain agents on Robinhood Chain. Three
  products share one rule: nothing gets signed unchecked.
---

# Build with Heimdall

Heimdall runs on Robinhood Chain mainnet (chain ID 4663).

| Product | What it does |
| --- | --- |
| [Shield](shield/transactions.md) | Simulate and judge any transaction before your agent signs it. |
| [Signature checks](shield/signatures.md) | Catch Permit and Permit2 drainers that never touch the chain. |
| [Vaults](products/vaults.md) | Run depositor money that can only trade with a Shield receipt. |
| [Signals](products/signals.md) | Buy or sell market signals per call, paid in USDG. |

## Quickstart: protect an agent in 2 minutes

**1. Install the SDK.**

```bash
npm install @heimdall/sdk viem
```

**2. Replace your agent's `sendTransaction` with `guardedSend`.** It asks Shield first and only sends on ALLOW.

```ts
import { HeimdallShield, guardedSend, HeimdallDenied } from "@heimdall/sdk";

const shield = new HeimdallShield({ apiKey: process.env.HEIMDALL_API_KEY }); // key optional on the free plan

try {
  const { hash } = await guardedSend(wallet, { to, data, value }, {
    shield,
    policy: { strict: true, maxNativeOut: "50000000000000000" }, // 0.05 ETH per tx
  });
} catch (e) {
  if (e instanceof HeimdallDenied) console.log(e.result.findings); // why it was blocked
}
```

**3. Check signatures too.** Before your agent signs a message (Permit, Permit2, marketplace order):

```bash
curl -X POST https://api.heimdall.fund/v1/check-signature \
  -H "content-type: application/json" \
  -d '{ "signer": "0xYourAgent", "typedData": { "domain": {…}, "types": {…}, "primaryType": "Permit", "message": {…} } }'
```

{% hint style="info" %}
No SDK? Everything is plain HTTP. See [Transaction checks](shield/transactions.md) for the full request and response.
{% endhint %}

## How the pieces fit

1. An agent builds a transaction (a swap, an approval, a transfer).
2. **Shield** simulates it on the latest Robinhood Chain block and answers ALLOW, WARN or DENY with reasons and an EIP-712 receipt valid for 120 seconds.
3. A **vault** only executes a manager's trade when it carries a fresh ALLOW receipt, and checks trade size and loss with price feeds.
4. Agents buy their edge from **Signals**, paying per call with gasless vouchers.
