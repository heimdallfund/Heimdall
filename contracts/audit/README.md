# Heimdall: audit pack

Everything an external auditor needs to scope, build and test the Heimdall contracts. Prepared 2026-11-23 (UTC).

| | |
| --- | --- |
| Chain | Robinhood Chain mainnet (chain ID 4663, Arbitrum Orbit, ~0.1 s blocks). No testnet deployment. |
| Compiler | Solidity 0.8.28, `viaIR`, optimizer runs = 1 (Vault and Deployer) and 200 (the rest), EVM target `cancun` |
| Libraries | OpenZeppelin Contracts 5.6.1 |
| Money at risk | USDG (Paxos Global Dollar, 6 decimals; pausable, with an address blocklist) and tokenized stocks (NVDA, TSLA, GOOGL, …, 18 decimals) |
| Owner of every contract | A Safe multisig through `Ownable2Step`. The deployer never keeps ownership. |
| Status | Not deployed yet. Four internal reviews (below), Slither, 143 tests (15 fuzz properties and 14 stateful invariants), 2 mainnet-fork tests and a full launch rehearsal on a fork (`scripts/rehearsal.sh`). |

## Scope

1,691 nSLOC (non-blank, non-comment lines). The hash is the first 12 hex characters of the file's SHA-256, so you can confirm the files match.

| File | nSLOC | SHA-256 | What it does |
| --- | ---: | --- | --- |
| `contracts/HeimdallVault.sol` | 439 | `79ef64579bb1` | ERC-4626 vault in USDG. An AI agent (the manager) trades tokenized stocks, but only through calls Shield has signed off on. Per-trade and rolling 24 h loss caps, high-water-mark fees, in-kind exit |
| `contracts/HeimdallPay.sol` | 198 | `589c67ef7805` | USDG escrow between agents: create, submit, release, dispute, arbiter resolve, 14-day dispute timeout, pull fallback for frozen addresses |
| `contracts/HeimdallSignals.sol` | 190 | `de9a3c9f10a8` | Pay-per-call data market: payers fund a balance and sign cumulative EIP-712 vouchers that providers redeem |
| `contracts/HeimdallAutoInvest.sol` | 142 | `288b05a713f5` | Recurring stock buys from the user's own wallet. Anyone can execute a due buy within the user's oracle price bound |
| `contracts/HeimdallVaultFactory.sol` | 121 | `707853a97ff7` | Deploys vaults with default limits, calls and caps |
| `contracts/HeimdallStaking.sol` | 101 | `1eff4a64b202` | Stake $HEIM, earn USDG streamed over 7 days (Synthetix style) |
| `contracts/ShieldGuarded.sol` | 56 | `af73648dc64e` | Verifies one-time EIP-712 Shield receipts (domain "Heimdall Shield", version 1) |
| `contracts/HeimdallFeeSplitter.sol` | 54 | `6c42a58f18eb` | Splits protocol fees between the stakers and the treasury |
| `contracts/HeimdallStockFeed.sol` | 58 | `64ea05f8667f` | Price adapter: Chainlink stock/USD ÷ USDG/USD; reports stale while the token's oracle is paused, after a multiplier change newer than the price, or while USDG is off peg |
| `contracts/HeimdallHolderBalance.sol` | 19 | `775e4fbe45c1` | `balanceOf` = $HEIM held + staked, read by vaults, Signals, Shield and the web for holder status |
| `contracts/HeimdallVaultDeployer.sol` | 18 | `f4fe199a25fc` | Holds the vault creation code for the factory |
| `contracts/HeimdallGuardModule.sol` | 165 | `061142122de6` | Safe module: an AI agent spends from a Safe only with a Shield receipt, within daily ETH and per-token limits; the owners keep full control |
| `contracts/HeimdallRiskOracle.sol` | 80 | `9948f0cc2196` | Onchain risk list (drainers, phishing, honeypots) written by a reporter, readable by any contract; the owner can pin entries |
| `contracts/HeimdallRiskAware.sol` | 23 | `dc315f55b3d9` | Abstract helper: `notBlocked` modifier with a gas-capped oracle read |
| `contracts/interfaces/IHeimdallRisk.sol` | 19 | `bd33869fcc18` | Risk Oracle interface and level/flag constants |
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
4. `../SECURITY_REVIEW.md` (vault, signals, factory, guard), `../SECURITY_REVIEW_2.md` (Pay, staking, splitter, stock feed) `../SECURITY_REVIEW_3.md` (all contracts: invariant testing, ERC-4626 views, build size) and `../SECURITY_REVIEW_4.md` (Risk Oracle, Guard module, x402 facilitator, Passport). Every finding has a PoC that is now a regression test under `test/poc/` and `test/poc2/`.

## Where we would like the most attention

1. **HeimdallVault `execute` and the call allowlist.** Can a manager with valid Shield receipts move value out of the vault, or lose more than `maxLossBps` per trade or `maxDailyLossBps` per 24 h?
2. **HeimdallAutoInvest.** It has only had an internal review (see KNOWN_ISSUES, section A). It pulls USDG from user wallets on a schedule, so any path that takes more than `amountPerBuy`, sends to someone other than the owner, or fills outside the bound is critical.
3. **HeimdallPay dispute paths.** Conservation on every path, the 14-day timeout, and the deferred-payout (`owed`) accounting when USDG freezes an address.
4. **HeimdallGuardModule.** Can an agent with valid Shield receipts move more out of a Safe than its daily limits, or change the Safe in any way? Tokens with unusual functions (ERC-677, ERC-777, rebasing) are of special interest.
5. **Price handling** for tokenized stocks: market hours, oracle pauses, USDG de-peg, and the multiplier-activation guard in `HeimdallStockFeed` (KNOWN_ISSUES Q-1).

## Contact

security@heimdall.fund. Findings in a private channel please, until a fix is deployed.
