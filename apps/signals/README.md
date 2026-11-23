# Heimdall official signals

Pay-per-call signals for agents, sold through HeimdallSignals. Every endpoint answers `402 Payment Required`
with payment instructions until the request carries a valid `x-heimdall-voucher`; the call is only charged
after the answer is produced.

| Endpoint | What | Default price |
| --- | --- | --- |
| `GET /v1/token-risk?token=0x…` | Contract checks, EIP-1967 proxy, owner powers (mint, pause, blacklist, fees), blocklist → score 0–100 | $0.02 |
| `GET /v1/address-intel?address=0x…` | EOA / contract / EIP-7702 delegate, activity, ETH + USDG balance, blocklist | $0.01 |
| `GET /v1/stock-premium?symbol=NVDA` | Onchain stock token price (pool) vs exchange reference price → premium in bps | $0.05 |
| `GET /v1/signals` | Catalogue | free |

Provider template: `gateVoucher` and `MemoryLedger` from `@heimdallfund/sdk` work in any server; production uses
`UpstashLedger` (atomic compare-and-set). `npm run redeem` claims the latest vouchers onchain.

Stock premium needs two data sources you choose: the stock token pools on Robinhood Chain (`STOCK_POOLS`) and an
exchange price API (`REFERENCE_PRICE_URL`). It returns 503 until both are set.
