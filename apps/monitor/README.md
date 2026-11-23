# Heimdall monitor

Watches every vault from the factory plus the Shield API and posts alerts to a private webhook (Discord, Slack or ntfy.sh):

| Alert | When |
|---|---|
| 🔴 Shield API is down | `/health` fails |
| 🔴 Stale price feed | a held asset cannot be valued |
| 🔴/🟠 Losing trade | one `execute` loses ≥ `TRADE_LOSS_ALERT_BPS` of NAV (critical from 2.5%) |
| 🔴/🟠 Daily loss budget | ≥ `DAILY_BUDGET_ALERT_PCT` of the 24h budget used |
| 🟠 Vault paused | `paused() == true` |
| 🔵 Deposit cap nearly full | NAV ≥ `CAP_ALERT_PCT` of the cap |

Conditions alert once when they start and once when they clear; losing trades alert once per transaction.

```bash
cp .env.example .env     # FACTORY, ALERT_WEBHOOK_URL …
npm install
npm run once             # single pass
npm start                # every INTERVAL_SEC
```
