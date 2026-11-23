# Heimdall contracts

| Contract | What it does |
| --- | --- |
| `ShieldGuarded` | Verifies Heimdall Shield EIP-712 receipts (signer allow-list, expiry, exact call match, replay protection) |
| `HeimdallVault` | ERC-4626 vault on USDG. The manager agent can only `execute` calls that carry an ALLOW receipt; trade size and NAV loss are checked onchain with price feeds; `transfer`/`transferFrom`/`setApprovalForAll` and approvals to unknown spenders are blocked; 15% performance fee over a high-water mark (10% manager, 5% platform); `redeemInKind` always lets depositors exit, even when paused or when a feed is stale |
| `HeimdallVaultFactory` | Anyone opens a vault and becomes its manager; vaults start from reviewed defaults and are owned by the platform Safe; risk caps (25% per trade, 3% loss) |
| `HeimdallSignals` | Signal registry + pay-per-call in USDG (90% provider / 10% treasury), direct `pay` or gasless cumulative EIP-712 vouchers with a withdrawal delay |

```bash
npm install
npx hardhat test          # 19 tests, incl. a receipt signed by the Shield API code
npx hardhat run scripts/deploy.ts --network robinhoodTestnet
```
