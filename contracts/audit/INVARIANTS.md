# Invariants

Each line is a property that must hold in every reachable state. "Fuzz" means a property-based test in `test/fuzz/` (256 runs; 10,000 with `npm run test:deep`). "Invariant" means a stateful test in `test/invariant/`: random sequences of every user action and time jumps (64 × 64; 512 × 200 with `npm run test:deep`). The rest are unit tests, regression PoCs or reasoning we would like you to challenge.

## HeimdallVault

| ID | Invariant | Checked by |
| --- | --- | --- |
| V-1 | After any `execute`, the vault has granted no allowance to an address outside the spender allowlist | Fuzz `testFuzz_tokenCallsCannotGrantAllowance` |
| V-2 | `execute` reverts for any (target, selector) not allowlisted by the owner | Fuzz `testFuzz_unknownTargetsRevert` |
| V-3 | A single `execute` lowers NAV by at most `maxLossBps`; NAV drops within one 24 h window add up to at most `maxDailyLossBps` (≤ 15%) | `vault.test.ts`, PoC H-01 |
| V-4 | Each Shield receipt can be used once, only by the vault it names, before its expiry, for exactly the calldata and value it hashes | `vault.test.ts` |
| V-5 | No performance fee is charged on donations, or on value that only existed before the first deposit | Fuzz `testFuzz_noFeeOnDonation` |
| V-6 | Deposit then withdraw in the same block never returns more than was deposited | Fuzz `testFuzz_roundTripNoProfit` |
| V-7 | `redeemInKind` pays each asset pro rata to shares, needs no price, and works while paused | Fuzz `testFuzz_inKindProRata` |
| V-8 | A stale or paused feed never values an asset; `maxWithdraw`/`maxRedeem` return 0 instead of reverting | `vault.test.ts`, PoC L-03 |
| V-9 | The manager cannot withdraw depositor funds or change any limit | `vault.test.ts` |
| V-10 | Shares never claim more than NAV | Invariant `invariant_sharesBacked` |
| V-11 | A hostile manager whose every call Shield approves extracts at most `maxDailyLossBps` of the window's NAV per 24 h | Invariant `invariant_theftBoundedByDailyLimit` |
| V-12 | Every holder can exit in kind at any time and receives something when their shares are worth something | Invariant `invariant_everyoneCanExit` |
| V-13 | `withdraw(maxWithdraw)` and `redeem(maxRedeem)` never revert; `preview*` equal what the call does, pending fee included | Fuzz `Vault4626Fuzz.t.sol`, handler `withdraw`/`redeem` |

## HeimdallPay

| ID | Invariant | Checked by |
| --- | --- | --- |
| P-1 | Every job's escrow is paid out exactly once, to the last unit, on every path (release, auto-release, refund, cancel, resolve, expired dispute) | Fuzz `testFuzz_conservation` |
| P-2 | `balanceOf(pay) = Σ escrow of open, submitted and disputed jobs + totalOwed`, under any sequence of actions and USDG freezes | Invariant `invariant_escrowBacked`, `invariant_owedSums`, `invariant_conservation` |
| P-3 | A frozen client, provider, arbiter or fee recipient cannot block payouts to anyone else; their share waits in `owed` | `PayPoc.t.sol` L01 |
| P-4 | A disputed job can always be settled: by the arbiter, or by anyone 14 days after the dispute (50/50, no arbiter fee) | `PayPoc.t.sol` M01 |
| P-5 | The fee of a job is fixed at creation (`feeBps` stored on the job, ≤ 3%) | `pay.test.ts` |

## HeimdallAutoInvest

| ID | Invariant | Checked by |
| --- | --- | --- |
| A-1 | One `execute` pulls exactly `amountPerBuy` from the plan owner and nothing from anyone else | Fuzz `testFuzz_boundedBuy` |
| A-2 | Every fill is at least `minOut = (swapIn at oracle price) × (1 − maxSlippageBps)`; a fill that meets the bound is never refused | Fuzz `testFuzz_boundedBuy` |
| A-3 | Bought tokens go to the plan owner; the contract keeps no stock and no router allowance, and its USDG equals `accruedFees` | Fuzz `testFuzz_boundedBuy` |
| A-4 | Nothing executes while the oracle is stale, paused or missing | Fuzz `testFuzz_staleOracleNeverBuys`, `autoinvest.test.ts` |
| A-5 | Buys happen at most once per `interval` and at most `buys` times; there is no catch-up burst after downtime | `autoinvest.test.ts` |
| A-6 | A plan's fee is fixed at creation (≤ 1%); a frozen fee recipient cannot block a buy | `autoinvest.test.ts` |

## HeimdallStaking and HeimdallFeeSplitter

| ID | Invariant | Checked by |
| --- | --- | --- |
| S-1 | The contract can always pay every staker's `earned` plus all principal | Fuzz `testFuzz_solvent`, invariants `invariant_heimBacked`, `invariant_rewardsSolvent`, `invariant_noRewardCreation` |
| S-2 | Only the splitter (`distributor`) can add rewards, so nobody can stretch or reset the stream | `StakingSplitterPoc.t.sol` L03 |
| S-3 | `distribute` always delivers the stakers' share, even when the treasury transfer fails | `StakingSplitterPoc.t.sol` L04 |
| S-4 | The stakers' share is at most 80% (`MAX_STAKER_BPS`) | `staking.test.ts` |

## HeimdallSignals

| ID | Invariant | Checked by |
| --- | --- | --- |
| G-1 | A provider never redeems more than the latest cumulative voucher the payer signed, nor more than the payer's available balance | Fuzz `testFuzz_vouchersNeverOverpay`, invariant `invariant_neverOverCharged` |
| G-4 | The contract holds exactly the sum of payer balances; funded = held + withdrawn + paid out | Invariants `invariant_balancesBacked`, `invariant_conservation` |
| G-2 | A pending withdrawal is excluded from `available` immediately, so a signed voucher cannot be raced | PoC M-04 |
| G-3 | `pay` never charges more than the caller's `maxPricePerCall` | PoC M-05 |

## HeimdallStockFeed

| ID | Invariant | Checked by |
| --- | --- | --- |
| F-1 | Returns stale (`updatedAt = 0`) while the token's oracle is paused, the quote is older than its max age, or USDG/USD is outside 0.90–1.10 | `stockfeed.test.ts` |
| F-2 | Fails closed: if `oraclePaused()` cannot be read, the price is stale | `stockfeed-vault.poc.test.ts` I-05 |
| F-3 | A price published before the token's multiplier took effect (`effectiveAt` in (`updatedAt`, now]) is reported stale; the multiplier is never applied twice | `stockfeed.test.ts` |

## HeimdallRiskOracle and HeimdallRiskAware

| ID | Invariant | Checked by |
| --- | --- | --- |
| R-1 | Only the reporter writes entries, at most 200 per call, levels 0 to 3 | `test_onlyReporter`, `test_validation` |
| R-2 | A pinned entry never changes until the owner unpins it | `test_pinBeatsReporter`, `sync.test.ts` |
| R-3 | `blockedCount` always equals the number of addresses at level 3 | Fuzz `testFuzz_blockedCountMatches` |
| R-4 | `notBlocked` refuses blocked addresses; a failing or hostile oracle costs at most 30,000 gas and follows `failClosed` | `test_riskAwareGate`, `test_riskAwareFailModes` |

## HeimdallGuardModule

| ID | Invariant | Checked by |
| --- | --- | --- |
| M-1 | Within any 24 h window, the Safe loses at most the ETH and per-token limits its owners set, whatever the agent sends | Invariants `invariant_lossBoundedByLimits`, `invariant_spentWithinLimit`; fuzz `testFuzz_windowNeverExceedsLimit` |
| M-2 | The agent can never call the Safe or the module, so it can never change owners, modules, limits or its own rights | `test_agentCannotAdministerSafeOrModule` |
| M-3 | Every call needs a fresh Shield ALLOW receipt for that Safe, target, calldata and value, used once | `test_receiptChecks`, `test_signerOverride` |
| M-4 | A limited token only takes calls the limit counts; an unlimited approval of a limited token is impossible | `test_limitedTokenOnlyTakesCountableCalls`, `test_approvalsCount_unlimitedImpossible_revokeAlwaysOk` |
| M-5 | A failed inner call reverts the whole execution and records no spend | `test_failedInnerCallReverts_noSpendRecorded` |
