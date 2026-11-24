---
description: >-
  An ERC-4626 vault on USDG whose manager is an AI agent. The agent can trade;
  it can never take depositor money.
---

# Vaults

## For depositors

* Deposit USDG, receive vault shares. The share price is NAV ÷ shares, with stock tokens valued by price feeds.
* `withdraw` / `redeem` pay USDG up to the vault's idle USDG. `redeemInKind` always works: it pays your share of every asset the vault holds, needs no price feed and works while the vault is paused. If a token is ever halted, `redeemInKindExcept` skips it.
* Fee: 15% of new profit above the high-water mark (10% to the manager, 5% to Heimdall), taken as newly minted shares. If the manager holds $HEIM, Heimdall's cut halves and the total is 12.5%. No management or withdrawal fee.
* Guarded launch: each vault starts with a 10,000 USDG deposit cap, raised by the Heimdall multisig as vaults build a record.

## For managers

Open a vault at [heimdall.fund/vaults/new](https://heimdall.fund/vaults/new) or call `createVault(name, symbol, maxTradeBps, maxLossBps)` on the factory. Your wallet becomes the manager. Caps: 25% of NAV per trade (2500 bps), 3% loss per trade (300 bps).

To trade, ask Shield about the call _as the vault_ (`from = vault`, `value = 0`), then pass the receipt to `execute`:

```ts
import { executeThroughVault } from "@heimdallfund/sdk";

// approve the router once, then swap — each call needs its own ALLOW receipt
await executeThroughVault(manager, { vault, target: USDG, data: approveRouterCalldata }, { shield });
await executeThroughVault(manager, { vault, target: router, data: swapCalldata }, { shield });
```

## What the vault enforces onchain

| Rule | Detail |
| --- | --- |
| Shield receipt | Signed by an approved Shield signer, verdict ALLOW, not expired, not used before, and for exactly this vault, target, calldata and value. |
| Allowlisted calls | Only (router, function) pairs reviewed by the multisig, e.g. a swap function. Everything else reverts. |
| Tokens | On USDG and tracked stock tokens only `approve` works: to an allowed spender, or 0 to revoke anyone. |
| Trade size | Value leaving the vault in one call ≤ `maxTradeBps` of NAV. |
| Loss per trade | NAV after the call ≥ NAV before × (1 − `maxLossBps`). |
| Loss per day | Trades can lose at most 5% of NAV in total per 24-hour window. |
| Prices | Chainlink-style feeds per asset with a heartbeat; a stale or broken feed pauses valuation-dependent actions, never in-kind exits. The multisig can replace a feed. |
| Re-entrancy | Every state-changing entry point is non-reentrant. |

{% hint style="info" %}
The vault owner is the Heimdall multisig, never the manager. The owner can pause, update allowed calls, spenders, assets and feeds, rotate the manager and the Shield signer, revoke approvals and set the deposit cap.
{% endhint %}
