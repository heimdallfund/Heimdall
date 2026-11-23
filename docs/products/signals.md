---
description: >-
  A marketplace where agents pay per answer in USDG. No subscriptions, no API
  contracts.
---

# Signals

## Paying as an agent

There are two ways to pay:

* **Direct:** call `pay(signalId, calls, requestId, maxPricePerCall)` and send the transaction hash to the provider.
* **Vouchers (recommended):** prefund once, then sign a voucher per call, offchain and without gas.

```ts
import { signVoucher, encodeVoucherHeader } from "@heimdall/sdk";

// once: USDG.approve(signals, amount) then signals.fund(amount)
spent += price;                                  // keep a running total per signal
const v = await signVoucher(agent, { chainId: 4663, signals, signalId, cumulativeAmount: spent });
const res = await fetch(endpoint, { headers: { "x-heimdall-voucher": encodeVoucherHeader(v) } });
```

Vouchers are _cumulative_: each one states the total you have ever agreed to pay this signal, so a provider can only ever claim the difference once. Withdrawing a prefunded balance takes `requestWithdraw`, then `withdraw` between 24 hours and 4 days later, so vouchers you already gave stay payable. A pending withdrawal stops counting toward `available(payer)` right away, which is what providers check.

## Selling as a provider

1. List the signal at [heimdall.fund/signals/new](https://heimdall.fund/signals/new) or call `register(uri, pricePerCall, payout)`. The `uri` is JSON: name, category, description, endpoint.
2. Put the voucher gate in front of your endpoint. Unpaid requests get `402 Payment Required` with payment instructions; charge only after you answered.
3. Redeem the latest voucher per payer regularly with `redeem(voucher, signature)`.

```ts
import { gateVoucher, MemoryLedger } from "@heimdall/sdk";

const ledger = new MemoryLedger(); // use a shared store (e.g. Redis) in production
app.get("/my-signal", async (c) => {
  const gate = await gateVoucher({ chainId: 4663, signals, signalId: 7n, pricePerCall: 20_000n, client, ledger }, c.req.header("x-heimdall-voucher"));
  if (!gate.ok) return c.json(gate.body, gate.status);   // 402 with how to pay
  const answer = await compute();
  if (!(await gate.commit())) return c.json({ error: "voucher_conflict" }, 409);
  return c.json(answer);
});
```

## Official Heimdall signals

| Endpoint | What | Price |
| --- | --- | --- |
| `/v1/token-risk?token=0x…` | Contract checks, upgradeable proxy, owner powers (mint, pause, blacklist, fees), blocklist → score 0–100 | $0.02 |
| `/v1/address-intel?address=0x…` | EOA, contract or EIP-7702 delegate; activity; ETH and USDG balance; blocklist | $0.01 |
| `/v1/stock-premium?symbol=NVDA` | Onchain stock token price vs exchange price, as a premium in bps | $0.05 |

{% hint style="info" %}
Every payment splits 90% to the provider and 10% to the Heimdall treasury (capped at 20% onchain). If the payout wallet holds at least 100,000 $HEIM, the split is 95/5.
{% endhint %}
