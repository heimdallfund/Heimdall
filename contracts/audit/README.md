# Heimdall: audit pack

Everything an external auditor needs to scope, build and test the Heimdall contracts. Prepared 2026-11-23 (UTC).

| | |
| --- | --- |
| Chain | Robinhood Chain mainnet (chain ID 4663, Arbitrum Orbit, ~0.1 s blocks). No testnet deployment. |
| Compiler | Solidity 0.8.28, `viaIR`, optimizer runs = 1 (Vault and Deployer) and 200 (the rest), EVM target `cancun` |
| Libraries | OpenZeppelin Contracts 5.6.1 |
| Money at risk | USDG (Paxos Global Dollar, 6 decimals; pausable, with an address blocklist) and tokenized stocks (NVDA, TSLA, GOOGL, …, 18 decimals) |
| Owner of every contract | A Safe multisig through `Ownable2Step`. The deployer never keeps ownership. |
| Status | Not deployed yet. Three internal reviews (below), Slither, 112 tests (13 fuzz properties and 15 stateful invariants), 2 mainnet-fork tests and a full launch rehearsal on a fork (`scripts/rehearsal.sh`). |

## Scope

1,404 nSLOC (non-blank, non-comment lines). The hash is the first 12 hex characters of the file's SHA-256, so you can confirm the files match.

| File | nSLOC | SHA-256 | What it does |
| --- | ---: | --- | --- |
| `contracts/HeimdallVault.sol` | 439 | `af191fc9842e` | ERC-4626 vault in USDG. An AI agent (the manager) trades tokenized stocks, but only through calls Shield has signed off on. Per-trade and rolling 24 h loss caps, high-water-mark fees, in-kind exit |
| `contracts/HeimdallPay.sol` | 198 | `4c56adcbcf9a` | USDG escrow between agents: create, submit, release, dispute, arbiter resolve, 14-day dispute timeout, pull fallback for frozen addresses |
| `contracts/HeimdallSignals.sol` | 190 | `9be7871d975d` | Pay-per-call data market: payers fund a balance and sign cumulative EIP-712 vouchers that providers redeem |
| `contracts/HeimdallAutoInvest.sol` | 142 | `4e2119cfc2fa` | Recurring stock buys from the user's own wallet. Anyone can execute a due buy within the user's oracle price bound |
| `contracts/HeimdallVaultFactory.sol` | 121 | `b9da0a8def19` | Deploys vaults with default limits, calls and caps |
| `contracts/HeimdallStaking.sol` | 101 | `8471382cd477` | Stake $HEIM, earn USDG streamed over 7 days (Synthetix style) |
| `contracts/ShieldGuarded.sol` | 56 | `af73648dc64e` | Verifies one-time EIP-712 Shield receipts (domain "Heimdall Shield", version 1) |
| `contracts/HeimdallFeeSplitter.sol` | 54 | `1d0a923947a5` | Splits protocol fees between the stakers and the treasury |
| `contracts/HeimdallStockFeed.sol` | 58 | `9d1b6ecadff5` | Price adapter: Chainlink stock/USD ÷ USDG/USD; reports stale while the token's oracle is paused, after a multiplier change newer than the price, or while USDG is off peg |
| `contracts/HeimdallHolderBalance.sol` | 19 | `454dc24b2b67` | `balanceOf` = $HEIM held + staked, read by vaults, Signals, Shield and the web for holder status |
| `contracts/HeimdallVaultDeployer.sol` | 18 | `a18fc5523050` | Holds the vault creation code for the factory |
| `contracts/interfaces/IPriceFeed.sol` | 8 | `7a2bae928384` | Chainlink-style interface |

Out of scope: `contracts/mocks/`, the tests, the off-chain services (Shield API, monitor, keeper, web app) and the $HEIM token itself, which is launched separately and has no Heimdall code.

## Build and test

```bash
cd contracts
npm ci
npx hardhat compile
npx hardhat test                    # every suite: node tests, Solidity tests and fuzz (256 runs each)
npx hardhat test solidity test/fuzz test/invariant   # fuzz and invariant tests only
npm run test:deep                   # the same at 10,000 fuzz runs and 512 × 200 invariant runs (about 4 minutes)
npm run size                        # production build + EIP-170 size check (run before any deployment)
FORK=1 RPC_URL_MAINNET=<archive RPC> npx hardhat test nodejs test/fork/*.fork.test.ts   # against forked mainnet state
```

Slither: `slither contracts/<File>.sol --solc-remaps "@openzeppelin/=node_modules/@openzeppelin/"`. The latest output for each file is in `reports/`.

## Read these first

1. [THREAT_MODEL.md](THREAT_MODEL.md): actors, what each may and may not do, and the attacks we care about most.
2. [INVARIANTS.md](INVARIANTS.md): the properties that must always hold, and which test or fuzz property checks each one.
3. [KNOWN_ISSUES.md](KNOWN_ISSUES.md): issues already found, the accepted risks and open questions, so you don't spend time re-reporting them.
4. `../SECURITY_REVIEW.md` (vault, signals, factory, guard), `../SECURITY_REVIEW_2.md` (Pay, staking, splitter, stock feed) and `../SECURITY_REVIEW_3.md` (all contracts: invariant testing, ERC-4626 views, build size). Every finding has a PoC that is now a regression test under `test/poc/` and `test/poc2/`.

## Where we would like the most attention

1. **HeimdallVault `execute` and the call allowlist.** Can a manager with valid Shield receipts move value out of the vault, or lose more than `maxLossBps` per trade or `maxDailyLossBps` per 24 h?
2. **HeimdallAutoInvest.** It has only had an internal review (see KNOWN_ISSUES, section A). It pulls USDG from user wallets on a schedule, so any path that takes more than `amountPerBuy`, sends to someone other than the owner, or fills outside the bound is critical.
3. **HeimdallPay dispute paths.** Conservation on every path, the 14-day timeout, and the deferred-payout (`owed`) accounting when USDG freezes an address.
4. **Price handling** for tokenized stocks: market hours, oracle pauses, USDG de-peg, and the multiplier-activation guard in `HeimdallStockFeed` (KNOWN_ISSUES Q-1).

## Contact

security@heimdall.fund. Findings in a private channel please, until a fix is deployed.
