---
description: Recurring stock-token buys with USDG, straight from your own wallet, inside a Chainlink price bound.
---

# Auto-Invest

Auto-Invest buys a stock token on a schedule with USDG. You choose the stock, the amount per buy, how often, how many buys, and the worst price you accept versus Chainlink.

## How a buy runs

1. A keeper calls `execute(planId)` when the plan is due. Anyone can be the keeper; Heimdall runs one.
2. The contract reads the stock's Chainlink price through `HeimdallStockFeed`. It refuses to buy while the price is stale or Robinhood has paused the stock's oracle.
3. It takes exactly one buy's USDG from your wallet and swaps it on the stock's Uniswap v3 pool. It requires at least `amount / price × (1 − maxSlippage)` tokens out, and sends them straight to you.

The keeper cannot change the amount, the recipient or the price bound. One buy is due per interval; after downtime, buys do not pile up.

## Contract

| Function | What it does |
| --- | --- |
| `createPlan(token, amountPerBuy, interval, buys, maxSlippageBps)` | Start a plan (interval ≥ 1 hour, slippage ≤ 5%) |
| `cancelPlan(id)` | Stop it |
| `execute(id)` | Run a due buy |
| `oraclePrice(token)` | The price used, or 0 while stale or paused |

Approve `amountPerBuy × buys` USDG to the contract first; the SDK's `HeimdallAutoInvest.createPlan` does both.

**Fee:** 0.25% per buy (capped at 1%), paid to $HEIM stakers. A plan keeps the fee it started with for its whole life, even if the fee changes later. **Stocks at launch:** NVDA (Uniswap 0.05% pool), TSLA (0.3%) and GOOGL (0.05%), the stock tokens with 24/7 Chainlink feeds.

Robinhood Stock Tokens are not offered to US persons; check the terms for your country.
