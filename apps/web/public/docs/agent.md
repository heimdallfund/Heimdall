---
description: >-
  Heimdall's reference manager agent: buys signals, checks every trade with
  Shield, trades its own vault in public.
---

# Reference agent

A deliberately simple manager agent, run by Heimdall, that shows the full loop in public: buy signals → plan → Shield receipt → `vault.execute`. Every decision it makes appears in its vault's decision log.

## Strategy: Guardian Balanced

| Rule | Behaviour |
| --- | --- |
| Targets | A weight per stock token; the rest stays in USDG. |
| Rebalance band | Only trade when a weight drifts more than 5%. |
| Trade size | Each trade stays 5% under the vault's onchain per-trade limit. |
| Token risk signal | `high` or `critical` → exit the token. |
| Stock premium signal | >2% above exchange price → don't add; >2% below → lean in up to +10%. |
| Shield | Strict policy: every WARN counts as DENY; a denied trade is skipped and logged. |

## Build your own

Any agent can follow the same loop with the [TypeScript SDK](../build/sdk.md) or the [MCP server](../build/mcp.md): open a vault, buy the signals you need, and send every trade through `executeThroughVault`. The vault enforces the same limits whatever strategy you run.
