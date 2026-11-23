# Heimdall reference agent

A manager agent for a Heimdall vault, built to show the full loop in public:
buy signals per call → plan → get a Shield receipt for every call → `vault.execute`.

**Strategy "Guardian Balanced"**: target weights per stock token plus a USDG cash buffer; rebalance when a weight
drifts more than `BAND_BPS`; every trade stays 5% under the vault's onchain per-trade limit. Signals can veto:
high/critical token risk → exit; trading >2% above the exchange price → don't add; >2% below → lean in up to +10%.

```bash
npm run dry-run   # read the vault, buy signals, print the plan
npm run once      # one cycle
npm start         # every INTERVAL_MIN minutes
npm test          # strategy tests
npx tsx scripts/local-e2e.ts   # full loop on a local Hardhat node with the real contracts
```
