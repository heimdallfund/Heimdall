# Heimdall contracts: security review 2

**Scope.** `HeimdallPay.sol`, `HeimdallStaking.sol`, `HeimdallFeeSplitter.sol` and `HeimdallStockFeed.sol`, plus how `HeimdallVault.sol` consumes the stock feed (`_tryValueOf`, `heartbeat`, `setFeed`). Solidity 0.8.28, OZ 5.6.1. The target is Robinhood Chain mainnet (4663, Arbitrum Orbit), and the money at risk is USDG (6 decimals, Paxos: pausable, with an address blocklist).

**Method.** I read every contract in full and checked the prior review (`SECURITY_REVIEW.md`), the existing tests and the Slither reports. Every suspected issue got a PoC under `test/poc2/`, and each PoC asserts the behaviour as it is today, so it passes while the issue exists. Paxos freezing is modelled by a token (`FreezableUSDG`, defined inside the test files) whose `_update` reverts when the sender or the receiver is frozen. I did not change any contract.

```
npx hardhat test solidity test/poc2/PayPoc.t.sol                     # 9 passing
npx hardhat test solidity test/poc2/StakingSplitterPoc.t.sol         # 6 passing
npx hardhat test nodejs   test/poc2/stockfeed-vault.poc.test.ts      # 5 passing
npx hardhat test                                                     # 90 passing (23 solidity, 67 nodejs)
```

**Verdict.** I found no Critical or High issue. Escrow conservation, staking solvency and the adapter math hold. The Medium issue (M-01) is a real loss and lock vector for providers. It should be fixed, or at least restricted with an arbiter allowlist, before agents start taking paid jobs automatically.

## Findings

| ID | Severity | Contract | Title | PoC file | Status |
|---|---|---|---|---|---|
| M-01 | Medium | HeimdallPay | Disputes have no timeout or fallback. The arbiter is chosen by the client alone, so a silent or frozen arbiter locks the escrow forever and a puppet arbiter hands 100% back to the client after delivery | `test/poc2/PayPoc.t.sol` (M01a, M01b, M01c) | proven |
| L-01 | Low | HeimdallPay | Push payments combined with the USDG blocklist: a frozen `feeRecipient` blocks every payout of every job, a frozen provider locks a submitted job, and frozen parties constrain or block `resolve` | `test/poc2/PayPoc.t.sol` (L01a, L01b, L01c) | proven |
| L-02 | Low | HeimdallPay | Reputation counters (`completedOf`, `earnedOf`, `disputedOf`) can be farmed with zero fee and griefed at zero cost | `test/poc2/PayPoc.t.sol` (L02) | proven |
| L-03 | Low | HeimdallStaking / FeeSplitter | `notifyReward(1)`, or a 2-unit `distribute`, restarts the 7-day period. Anyone can stretch the stream and shift ~37% of a week's rewards to later stakers for 0.000168 USDG | `test/poc2/StakingSplitterPoc.t.sol` (L03, L03b) | proven |
| L-04 | Low | HeimdallFeeSplitter | A frozen treasury also blocks the stakers' share, because `distribute` is all-or-nothing | `test/poc2/StakingSplitterPoc.t.sol` (L04) | proven |
| L-05 | Low | HeimdallVault + StockFeed | One paused or stale stock with a non-zero balance stops USDG deposits, USDG withdrawals and every manager trade vault-wide, including de-risking trades | `test/poc2/stockfeed-vault.poc.test.ts` (L-05) | proven |
| I-01 | Info | HeimdallPay | Anyone can refund an expired Open job, which pre-empts a client who wants to accept a late delivery | `test/poc2/PayPoc.t.sol` (I01) | proven |
| I-02 | Info | HeimdallFeeSplitter | With zero stakers, the stakers' share goes to the treasury instead of the staking contract's `unassigned` bucket | `test/poc2/StakingSplitterPoc.t.sol` (I02) | proven |
| I-03 | Info | HeimdallStaking | USDG sent directly to the contract, and rounding dust, are stuck forever (no sweep) | `test/poc2/StakingSplitterPoc.t.sol` (I03) | proven |
| I-04 | Info | HeimdallVault + StockFeed | The `updatedAt = 0` stale sentinel is defeated by any `heartbeat >= block.timestamp`, and the heartbeat has no upper bound | `test/poc2/stockfeed-vault.poc.test.ts` (I-04) | proven |
| I-05 | Info | HeimdallStockFeed | `paused()` fails open: a token without `oraclePaused()`, or the wrong token address, is reported live | `test/poc2/stockfeed-vault.poc.test.ts` (I-05) | proven |
| I-06 | Info | HeimdallPay | Fee-on-transfer not supported; no `maxFeeBps` on `createJob`; unbounded `jobsOf*` arrays; arbiter fee and arbiter collusion bypass the protocol fee; Arbitrum timestamp drift | none | unproven |
| I-07 | Info | HeimdallStockFeed | Feed and quote decimals are cached; weekend/market-hours heartbeat trade-off; no sequencer-uptime check (see prior M-06) | none | unproven |

### Checked, no issue found
- **Conservation in HeimdallPay.** `arbFee + fee + toProvider + toClient == amount` on every path. The existing fuzz test covers this, and I re-checked the `resolve` rounding by hand. The Slither "divide-before-multiply" warning is harmless because the remainder goes to the client.
- **Boundaries in HeimdallPay.** `deadline == now`: `createJob` rejects it, `submit` accepts it and `refund` rejects it. Review window: `dispute` works while `now < submittedAt + window`, and `claim` works when `now >= submittedAt + window`. The two never overlap and leave no gap (`test_boundaries_consistent`).
- **Integer types.** `uint96` amount, `uint64` deadline and `submittedAt`, and `uint32` window are all taken as typed parameters or a safe `uint64(block.timestamp)` cast. Nothing truncates.
- **Reentrancy.** Every function that moves funds is `nonReentrant` and updates state first (CEI). `submit` and `dispute` make no external calls.
- **Access control.** `release` and `dispute` are client-only, `submit` and `cancel` provider-only, `resolve` arbiter-only, and `setFee` is owner-only via Ownable2Step with a 3% cap. The fee is snapshotted per job. The splitter owner is capped at 80%.
- **Staking solvency and precision.** The `1e18 × 1e18` scaling keeps precision with 1e27 HEIM staked. No overflow path exists, because `stakedOf × Δrpt ≤ rate × dt × 1e18`. The `unassigned` round trip is solvent (`test_unassigned_roundtrip_solvent`). A large stake placed just before a `notifyReward` call earns only pro rata over 7 days. The `heim == usdg` constructor guard is present.
- **Splitter.** It uses `forceApprove` for exactly the amount `notifyReward` pulls, resets the allowance when the staking address changes, and short-circuits when `stakerBps == 0`.
- **Adapter math.** `answer × 10^qDec / q` keeps the feed's decimals. The band is inclusive at 0.90 and 1.10. A quote that is stale, in the future, ≤ 0, short or reverting makes the adapter report stale. An overflow makes the adapter revert, and the vault then treats the price as stale (fails closed). The 63/64-gas trick cannot force `oraclePaused()` to fail, because the rest of a vault call needs far more gas than 1/64 of what the inner call would get.

---

## M-01 (Medium): no exit from `Disputed`; the client-chosen arbiter can lock or seize the escrow

**Description.** Once `dispute()` runs, `resolve()` by `j.arbiter` is the only transition out of `Disputed`. There is no timeout and no fallback arbiter, and nobody else can move the job. The client alone sets the arbiter in `createJob`. The only checks are `arbiter != client` and `arbiter != provider`, and a second wallet of the client passes both. The provider never explicitly accepts the arbiter. Submitting the work is the implicit acceptance, and the code cannot undo it.

**Impact.**
- **(a) Silent arbiter.** A lost key, a dead agent or a griefer means the whole escrow stays locked forever. This hurts both parties.
- **(b) Frozen arbiter.** If Paxos blocklists the arbiter while `arbiterFeeBps > 0`, every `resolve` call reverts, because it pushes the fee to the arbiter. The lock is permanent.
- **(c) Puppet arbiter.** The client receives the delivered work and recovers 100% of the escrow: the refund plus the arbiter fee, which goes to its own puppet. The provider gets 0 and its record gains a dispute. This is the main threat in an agent-to-agent market, where providers accept jobs automatically.

**Exploit scenario.** The client creates a 1,000 USDG job with `arbiter = clientWallet2` and `arbiterFeeBps = 1000`. The provider agent delivers and calls `submit`. The client calls `dispute("pretext")`, then `clientWallet2` calls `resolve(id, 0)`. The client side gets 100 + 900 = 1,000 USDG, and the provider gets 0.

**PoC.** `npx hardhat test solidity test/poc2/PayPoc.t.sol`
- `test_M01a`: ten years after a dispute, `claim`, `refund`, `release`, `cancel` and `dispute` all revert, and the contract still holds 1,000e6.
- `test_M01b`: with the arbiter frozen, `resolve` reverts with "address frozen" at 0, 25, 50, 75 and 100%.
- `test_M01c`: client plus puppet recover exactly the initial balance; the provider gets 0, protocol fees are 0, and `disputedOf` is 1.

**Fix.**
```solidity
uint32 public constant ARBITRATION_TIMEOUT = 14 days;
// Job: add `uint64 disputedAt;` (set in dispute())

function dispute(uint256 id, string calldata reason) external {
    ...; j.status = Status.Disputed; j.disputedAt = uint64(block.timestamp); ...
}

/// Arbiter missed the deadline: settle without it (no arbiter fee). Pick a documented default,
/// e.g. pay the provider (the client chose the arbiter) or split 50/50.
function settleExpiredDispute(uint256 id) external nonReentrant {
    Job storage j = _jobs[id];
    if (j.status != Status.Disputed) revert WrongStatus(j.status);
    if (block.timestamp < uint256(j.disputedAt) + ARBITRATION_TIMEOUT) revert TooEarly();
    j.arbiterFeeBps = 0;
    _settle(id, j, DEFAULT_PROVIDER_BPS); // same maths as resolve(), via the pull-payment helper of L-01
}
```
Also do one of the following:
- Have the Safe maintain an arbiter allowlist: `mapping(address => bool) public approvedArbiter;` and in `createJob` add `if (arbiter != address(0) && !approvedArbiter[arbiter]) revert InvalidConfig();`.
- Or require the provider to accept the job's terms (`accept(id)` before `submit`, or a provider EIP-712 signature over `(arbiter, arbiterFeeBps, amount, deadline)` checked in `createJob`).

Pay the arbiter fee through the pull path of L-01, so a frozen arbiter can never block a settlement.

## L-01 (Low): push payments and the USDG blocklist block payouts

**Description.** `_release`, `_refund` and `resolve` push USDG to `feeRecipient`, `provider`, `client` and `arbiter` in the same transaction that changes state. Paxos can freeze any address, and a transfer to a frozen address reverts.

**Impact.**
- **(a) Frozen `feeRecipient`.** Every `release`, `claim` and `resolve` with a fee greater than 0 reverts, for every job. Recovery needs a Safe transaction (`setFee` with a new recipient).
- **(b) Frozen provider on a submitted job without an arbiter.** `claim` and `release` revert, and `refund` only works for Open jobs, so the escrow is stuck indefinitely.
- **(c) Disputed job.** A frozen provider forces the arbiter to choose `providerBps = 0`. A frozen client forces 100%. With both frozen, no split works.

**PoC.** In `test/poc2/PayPoc.t.sol`:
- `test_L01a`: `release` and `claim` revert with "address frozen" until the owner calls `setFee(100, newRecipient)`.
- `test_L01b`: one year later, `claim` still reverts and 500e6 is locked.
- `test_L01c`: a 50% split reverts; once both parties are frozen, 0% and 100% revert too.

**Fix.** Use pull payments for fees and for any transfer that fails:
```solidity
mapping(address => uint256) public owed;
uint256 public feesAccrued;

function _pay(address to, uint256 amt) internal {
    if (amt == 0) return;
    if (!usdg.trySafeTransfer(to, amt)) owed[to] += amt;   // OZ >= 5.2 SafeERC20.trySafeTransfer
}
function withdrawOwed(address to) external nonReentrant {
    uint256 a = owed[msg.sender]; owed[msg.sender] = 0; usdg.safeTransfer(to, a);
}
function sweepFees() external nonReentrant { uint256 f = feesAccrued; feesAccrued = 0; usdg.safeTransfer(feeRecipient, f); }
// _release / resolve: feesAccrued += fee; _pay(j.provider, toProvider); ...
```
`withdrawOwed(to)` lets a party that was frozen and later unfrozen, or one with a new wallet, collect its funds.

## L-02 (Low): reputation counters are cheap to farm and to grief

**Description.** `fee = amount * feeBps / 10_000` rounds down, so any job under 100 raw units (0.0001 USDG) pays no fee. `completedOf` increments on every release, including a release of an Open job by a client who is really the provider's own second wallet. `disputedOf` increments on any dispute, including one resolved by the disputer's own puppet arbiter, which returns the whole amount to the disputer.

**Impact.** The "public track record … for reputation and badges" is meaningless. A provider can mint any number of completed jobs for gas only. A rival can give any provider that accepts jobs automatically a dispute for 1 raw unit, which is refunded.

**PoC.** `test_L02` creates 50 jobs of 99 raw units each: `completedOf` becomes 50, fees paid are 0, and every unit ends up back with the provider. A rival's 1-unit bait job then raises `disputedOf` to 1, and the rival gets its 1 unit back.

**Fix.**
- Add `uint96 public constant MIN_AMOUNT = 1e6;` (1 USDG) to `createJob`.
- Round the fee up: `Math.mulDiv(amount, feeBps, 10_000, Math.Rounding.Ceil)`.
- Increment `completedOf` only for jobs that were actually `Submitted`.
- Record disputes per outcome, for example a `lostDisputesOf` counter when `providerBps < 5000`, and only for allowlisted arbiters (M-01).
- Front-ends should weight reputation by volume and by unique clients.

## L-03 (Low): anyone can stretch the reward stream with dust `notifyReward`

**Description.** `notifyReward` has no access control and accepts `amount = 1`. Each call does `rewardRate = (total + leftover) / 7 days` and sets `periodFinish = now + 7 days`, so the remaining rewards are spread over a fresh 7 days. Repeated calls turn the linear 7-day stream into an exponential decay with a 7-day time constant. `HeimdallFeeSplitter.distribute` gives the same lever to anyone: donate 2 raw units, then call `distribute`.

**Impact.** No funds are lost, but rewards earned during a week are delayed and handed to whoever is staked later. Stakers who leave lose their share. The griefer pays dust and gas, which is cheap on an Orbit chain with 100 ms blocks.

**PoC.** `npx hardhat test solidity test/poc2/StakingSplitterPoc.t.sol`
- `test_L03`: 7,000 USDG is notified with one staker (Alice). Without griefing she earns **6,999.99 USDG** in 7 days. With one `notifyReward(1)` per hour she earns **4,432.53 USDG**, and a staker who arrives after she leaves collects **2,567.47 USDG**. The attack cost 168 raw units (0.000168 USDG).
- `test_L03b`: on day 6, a 2-unit `distribute` moves `periodFinish` 6 days later and cuts the rate from 1,000 to about 143 USDG/day.

**Fix.** Restrict the caller, and stop small top-ups from resetting the period:
```solidity
address public immutable distributor;          // the FeeSplitter
uint256 public constant MIN_NOTIFY = 100e6;    // or: only extend when amount >= leftover / 10

function notifyReward(uint256 amount) external nonReentrant update(address(0)) {
    if (msg.sender != distributor) revert NotAllowed();
    ...
    if (block.timestamp < periodFinish && total < leftover / 10) {
        // small top-up: add to the current period, do not push periodFinish
        rewardRate += total * 1e18 / (periodFinish - block.timestamp);
        lastUpdate = block.timestamp;
        emit RewardAdded(amount, periodFinish);
        return;
    }
    ...
}
```
In the splitter, also rate-limit `distribute` for USDG (for example `if (block.timestamp < lastDistribute + 1 days) skip the staker part`) or require a minimum balance.

## L-04 (Low): a frozen treasury blocks stakers' rewards

**Description.** `distribute(usdg)` calls `staking.notifyReward(toStakers)` and then `token.safeTransfer(treasury, rest)` in the same transaction. If Paxos freezes the treasury, the second transfer reverts and the whole distribution rolls back.

**Impact.** Stakers receive nothing until the Safe calls `setConfig` with a new treasury. Fees pile up in the splitter in the meantime. The same applies to any other token whose transfer to the treasury reverts.

**PoC.** `test_L04`: `distribute` reverts with "address frozen" and the staking contract's balance stays 0.

**Fix.**
```solidity
uint256 rest = bal - toStakers;
if (rest > 0 && !token.trySafeTransfer(treasury, rest)) rest = 0; // keep it here; retried next distribute
```

## L-05 (Low): one paused stock freezes the whole vault except in-kind exits

**Description.** When `oraclePaused()` is true, or a feed is stale, the adapter returns `updatedAt = 0`. In the vault, `_tryTotalAssets` then fails for the whole vault whenever that stock's balance is non-zero. As a result:
- `totalAssets` reverts.
- `maxDeposit` and `maxWithdraw` return 0.
- `execute` reverts on `navBefore`.

The manager therefore cannot trade at all. That includes selling other assets or moving idle USDG to cut risk while a corporate action lasts, and corporate actions can take days. USDG withdrawals stop for every depositor.

**Impact.** Availability only. `redeemInKind` still works, which the PoC confirms. This fails closed, but a paused stock that is a small part of the vault halts everything.

**PoC.** `npx hardhat test nodejs test/poc2/stockfeed-vault.poc.test.ts`, test "L-05": `deposit` reverts with `ERC4626ExceededMaxDeposit`, `withdraw` with `ERC4626ExceededMaxWithdraw`, and `execute` with `StalePrice`, while `redeemInKind` succeeds.

**Fix.**
- Store the last good price per asset (`lastGoodPrice[token]`, updated whenever the feed is fresh).
- In `execute`, allow trades that leave every stale asset's balance unchanged: value stale assets at their last good price on both sides, so they cancel out in the before/after NAV comparison. Require `balancesAfter[i] == balancesBefore[i]` for each stale `i`.
- Keep deposits and NAV withdrawals blocked as they are today, or allow withdrawals at a conservative valuation of `min(lastGood, 0)` for the paused leg, paid out in kind.

## I-01 (Info): third parties can refund an expired Open job

`refund` is permissionless once `now > deadline`. A client who wanted to accept a late delivery off-chain, and then `release`, can be pre-empted by anyone. **PoC:** `test_I01`. **Fix:** in `refund`, allow only the client (or the provider through `cancel`), or open it to anyone only after a grace period: `if (msg.sender != j.client && block.timestamp <= j.deadline + 7 days) revert NotAllowed();`.

## I-02 (Info): the stakers' share is lost when nobody stakes

The splitter sends 100% to the treasury when `totalStaked() == 0`, even though `HeimdallStaking` has a purpose-built `unassigned` bucket. Anyone can stake 1 wei to switch the flow back on, so this is a design note, not an exploit. **PoC:** `test_I02`. **Fix:** drop the `totalStaked() > 0` condition. `notifyReward` already works with zero stakers and folds the rewards in later.

## I-03 (Info): stray USDG is stuck in staking

There is no sweep, so USDG transferred directly to the staking contract, and rounding dust, can never be withdrawn. **PoC:** `test_I03` (500e6 is still there after everyone exits). **Fix:** add a permissionless `notifyExcess()` that calls `notifyReward` with `balance - (owed + unassigned + streaming)`. Accounting for `owed` needs a running `totalRewardsOwed`.

## I-04 (Info): a heartbeat ≥ `block.timestamp` disables the stale sentinel

The vault's staleness check is `block.timestamp - updatedAt > heartbeat`. With the adapter's `updatedAt = 0`, it holds only while `heartbeat < block.timestamp` (about 1.79e9 seconds today). `addAsset` and `setFeed` accept any non-zero `uint32` heartbeat, up to 4.29e9. An owner who sets a "never stale" heartbeat silently disables the corporate-action pause and the depeg band. **PoC:** test "I-04": after `setFeed(nvda, adapter, 4e9)`, `totalAssets()` returns 5,000 USDG with the token paused and with USDG at $0.50, even though the adapter reports `updatedAt = 0`. **Fix:** in `_tryValueOf`, add `if (updatedAt == 0) return (false, 0);`, and in `_addAsset` and `setFeed`, add `if (heartbeat > 7 days) revert InvalidConfig();`.

## I-05 (Info): `paused()` fails open

`paused()` returns false when the staticcall fails or returns less than 32 bytes. That covers a token without `oraclePaused()`, an EOA, a renamed function after an upgrade, or the wrong token wired at deploy time. The constructor does not validate the token. **PoC:** test "I-05": adapters wired to a plain ERC-20 and to USDG both report live. **Fix:**
- In the constructor, add `(bool ok, bytes memory r) = token_.staticcall(abi.encodeWithSignature("oraclePaused()")); if (!ok || r.length != 32) revert InvalidConfig();`.
- In `paused()`, treat a failed call as paused: `if (!ok || ret.length < 32) return true;`.
- Have the vault check `adapter.token() == token` in `setFeed` and `addAsset` when the feed is an adapter.

## I-06 (Info, unproven): HeimdallPay, other notes

- **Fee-on-transfer.** `createJob` records `amount`, not the amount actually received. If Paxos ever enabled a transfer fee on USDG, the last payouts would fail. Measure the balance before and after the transfer, or document that USDG is assumed fee-free.
- **No `maxFeeBps` argument.** `createJob` has no bound on the snapshotted fee, so a client can be front-run by `setFee`. The Safe is trusted and the cap is 3%.
- **Unbounded arrays.** `jobsOfClient` and `jobsOfProvider` return arrays anyone can grow by spamming 1-unit jobs, which is a risk for off-chain readers. Add paginated getters.
- **Fee bypass.** The arbiter fee (up to 10%) carries no protocol fee. A provider-controlled arbiter, or an off-chain side deal, can route value around the protocol fee.
- **Timestamp drift.** The Arbitrum sequencer can drift timestamps (down to about 24 h behind L1 and up to about 1 h ahead). Review windows of 1 h are therefore weak guarantees. Consider `MIN_REVIEW = 6 hours`.

## I-07 (Info, unproven): HeimdallStockFeed, other notes

- **Cached decimals.** `_decimals` and `_quoteDecimals` are cached, and the vault caches `feedDecimals`. If a Chainlink proxy is ever repointed to an aggregator with different decimals, prices are off by a factor of 10^k. Re-read `decimals()` in `latestRoundData` and return stale on a mismatch.
- **Weekend heartbeat.** A heartbeat long enough to cover weekends (more than 65 h) lets deposits and withdrawals go through at Friday's close while other venues are already pricing the stock. This is the oracle-latency arbitrage of prior M-06.
- **No sequencer-uptime check.** Neither the adapter nor the vault checks sequencer uptime.

## Fix status (2026-11-23)

| ID | Status | Fix |
| --- | --- | --- |
| M-01 | Fixed / mitigated | `settleExpiredDispute`: 14 days after a dispute, anyone can split the escrow 50/50 with no arbiter fee. Payouts to a frozen arbiter are deferred, so `resolve` always goes through. The client still picks the arbiter, but `submit` is documented as acceptance of it, and the job page, SDK and MCP tool show the arbiter before any work starts. The provider can `cancel` a job whose arbiter it does not trust. |
| L-01 | Fixed | `_pay` pushes each payout and, if the transfer fails (for example a frozen address), records it in `owed` for `withdrawOwed` instead of reverting. One frozen party can no longer block another party or another job. |
| L-02 | Fixed | `MIN_AMOUNT` = 1 USDG, so every completed job pays a non-zero fee and dust disputes cost real money. |
| L-03 | Fixed | `HeimdallStaking.notifyReward` is restricted to an immutable `distributor` (the fee splitter). |
| L-04 | Fixed | `distribute` pays stakers first; a failed treasury transfer leaves that share in the splitter and emits `TreasuryTransferFailed`. |
| L-05 | Accepted | By design: a vault never prices with a stale or paused oracle. `redeemInKind` keeps exits open. Documented in RUNBOOK. |
| I-01 | Accepted | Refunding an expired job is intentionally permissionless. |
| I-02 | Fixed | With zero stakers, the stakers' share goes to the staking contract, where it waits in `unassigned` for the first stakers. |
| I-03 | Accepted | No sweep, so the staking contract keeps no admin keys. |
| I-04 | Fixed | `HeimdallVault` rejects any heartbeat above `MAX_HEARTBEAT` (7 days). |
| I-05 | Fixed | `HeimdallStockFeed` rejects a token without `oraclePaused()` at construction, and `paused()` fails closed. |
| I-06, I-07 | Noted | No fee-on-transfer support is needed for USDG. Sequencer-uptime checks remain an open item from review 1 (M-06). |

The PoC files in `test/poc2/` are now regression tests that assert the fixed behaviour. Full suite: 91 passing (23 Solidity, 68 node).

## Addendum: HeimdallAutoInvest (2026-11-23 UTC)

An internal pass over `HeimdallAutoInvest.sol`, which neither review covered. Slither: `reports/slither-HeimdallAutoInvest.txt`.

| ID | Severity | Issue | Status |
| --- | --- | --- | --- |
| A-01 | Low | The fee was read at execution time, so the owner could raise it (up to 1%) for existing plans | Fixed: stored on the plan at creation |
| A-02 | Low | The fee was pushed to `feeRecipient` on every buy, so a frozen recipient blocked every plan | Fixed: fees accrue; `sweepFees()` (anyone) sends them on, and the keeper sweeps before the daily distribution |
| A-03 | Info | The keeper can time a buy and sandwich it down to the owner's bound (≤ 5%) | By design; the app defaults to 1% |
| A-04 | Info | Slither `arbitrary-send-erc20` on `execute` | By design: the owner's own plan, `amountPerBuy` only, only when due |
| A-05 | Info | Plans on 24/5 feeds skip weekends, without catch-up | By design |

New fuzz properties: `testFuzz_boundedBuy` (exact pull, fill within bound, nothing left behind, a fill within the bound is never refused) and `testFuzz_staleOracleNeverBuys`. Open question for an external audit: how `uiMultiplier()` (corporate actions) relates to the Chainlink stock feeds (see `audit/KNOWN_ISSUES.md`, Q-1).
