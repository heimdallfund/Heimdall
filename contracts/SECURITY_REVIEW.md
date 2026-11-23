# Heimdall contracts: security review

Scope: `ShieldGuarded.sol`, `HeimdallVault.sol`, `HeimdallVaultFactory.sol`, `HeimdallVaultDeployer.sol`, `HeimdallSignals.sol` (Solidity 0.8.28, OZ 5.6). Mocks are out of scope. I read the Shield API code (`apps/shield/src`) only to judge whether the off-chain layer would stop an on-chain issue. It is not a security boundary for the "manager can never extract value" guarantee.

PoCs live in `test/poc/` and `contracts/mocks/poc/PocMocks.sol`. Run them with `npx hardhat test nodejs`. Each PoC asserts the **vulnerable** behaviour, so it passes while the bug is present and should be flipped or removed once the bug is fixed. All 32 tests pass: 21 existing and 11 PoC.

**Verdict: not ready for a mainnet launch with user funds.** C-01, H-01 and H-02 each break the core guarantee that the manager can never extract depositor value. The guarantee that redeemInKind is always available does not hold either (M-01).

## Findings

| ID | Severity | Title | Contract:function | Status |
|---|---|---|---|---|
| C-01 | Critical | Approval guard bypassed with `increaseApproval` (mainnet USDG supports it), so the manager can drain 100% | HeimdallVault:`_checkSelector` / `execute` | Proven-by-test |
| H-01 | High | Loss limit is per call, not cumulative; repeated bad-price trades drain NAV | HeimdallVault:`execute` | Proven-by-test |
| H-02 | High | HWM not reset at zero supply, so a 1-wei to 1-USDG donation turns 7.5–15% of the next deposit into "performance fee" | HeimdallVault:`_harvest` / `deposit` / `mint` | Proven-by-test |
| M-01 | Medium | `redeemInKind` is not an unconditional exit: `_harvest` can revert, and one halted token blocks everything | HeimdallVault:`redeemInKind`, `_tryValueOf` | Proven-by-test |
| M-02 | Medium | No way to replace a feed; a dead feed on a held asset freezes deposits, withdrawals and trading permanently | HeimdallVault:`_addAsset` / `removeAsset` / `totalAssets` | Proven-by-test |
| M-03 | Medium | Approvals to a de-listed spender cannot be revoked; the owner has no revoke path | HeimdallVault:`_checkSelector` / `setSpender` | Proven-by-test |
| M-04 | Medium | Withdrawal delay can be pre-armed, so accepted vouchers become unredeemable | HeimdallSignals:`requestWithdraw` / `withdraw` | Proven-by-test |
| M-05 | Medium | `pay()` has no price bound; the provider can front-run it with `update()` | HeimdallSignals:`pay` / `update` | Proven-by-test |
| M-06 | Medium | Instant deposit and withdrawal at oracle NAV allow oracle-latency arbitrage against holders; no sequencer-uptime check | HeimdallVault:`deposit` / `withdraw` / `redeem` | Reasoned |
| L-01 | Low | Per-call NAV check cannot see deferred effects or liabilities (pre-signed orders, debt, LP, multicall tokens) | HeimdallVault:`execute`, `_tryTotalAssets` | Reasoned |
| L-02 | Low | Fee is silently skipped on a stale feed (fee avoidance via `redeemInKind`; `setManager` misattributes the fee) | HeimdallVault:`_harvest` | Reasoned |
| L-03 | Low | `maxWithdraw`, `maxRedeem` and `preview*` revert on a stale feed (ERC-4626 says MUST NOT revert) | HeimdallVault:`maxWithdraw` / `maxRedeem` | Reasoned |
| L-04 | Low | Voucher balance is shared across signals: over-commitment races and no partial redeem | HeimdallSignals:`redeem` | Reasoned |
| L-05 | Low | Vault uses single-step `Ownable`; the owner can set arbitrary feeds and signers without a timelock | HeimdallVault (admin) | Reasoned |
| I-01 | Info | Receipts are not bound to the manager or a nonce and survive `setManager` | ShieldGuarded:`_consumeReceipt` | Reasoned |
| I-02 | Info | `redeemInKind` ignores the virtual shares, so it pays slightly more than `convertToAssets` | HeimdallVault:`redeemInKind` | Reasoned |
| I-03 | Info | Untracked or removed tokens are invisible to NAV and to `redeemInKind` (stuck) | HeimdallVault | Reasoned |
| I-04 | Info | Factory and deployer config is not validated | HeimdallVaultFactory:`setDefaults` / `setCaps`, constructor | Reasoned |
| I-05 | Info | `scripts/deploy.ts` redeclares `const deployer`, so the script throws a SyntaxError | scripts/deploy.ts | Reasoned |
| I-06 | Info | Signals fee rounds to 0 on dust; a fee change applies to signed vouchers; EIP-1271 payers can revoke | HeimdallSignals | Reasoned |

Categories checked with **no issue found**:
- **Receipt replay across vaults and chains:** prevented by the `agent == address(this)` check and the chainId in the domain.
- **Single use:** each receipt can be used once (`usedCheckId`).
- **Signature malleability:** OZ `ECDSA.recover` rejects high-s and invalid signatures.
- **Value:** forced to 0.
- **Reentrancy:** all state-changing vault entry points are `nonReentrant`, so a target cannot deposit, redeem or harvest mid-trade. Read-only reentrancy exists: `totalAssets` and `convertToAssets` return intermediate values during `execute`. That matters only to third parties that price hTokens on-chain; they should not do that during the call.
- **Classic ERC-4626 inflation attack:** with offset 6 it is unprofitable. The donation problem that does exist is the fee interaction in H-02.
- **Gas in the `MAX_ASSETS` loops:** fine at 16 assets.
- **Selector constants:** correct, including Permit2 `approve` = 0x87517c45.
- **Deployer wiring:** only the creator can set the factory, once.
- **Factory access control:** correct.
- **Signals EIP-712 domain:** includes `verifyingContract`.
- **Voucher cumulative accounting:** correct.

---

## C-01 (Critical): approval guard bypass with `increaseApproval`

**Description.** `_checkSelector` uses a *denylist*. It inspects only `approve` (0x095ea7b3), `increaseAllowance` (0x39509351) and Permit2 `approve`, and forbids `transfer`, `transferFrom` and `setApprovalForAll`. Every other selector on an allowed target is passed through. Base USDG and the tracked tokens must be allowed targets so the vault can approve routers, so any alternative allowance function on those tokens is unchecked.

The mainnet USDG at `0x5fc5360D…1d168` is a Paxos token. I checked it with `eth_call`: `increaseApproval(address,uint256)` (0xd73dd623) succeeds and returns `true`, while `increaseAllowance` reverts. The same class covers `transferAndCall` (ERC-677/1363), `approveAndCall`, and tokens that implement `multicall` (the inner `approve` is not decoded).

**Exploit.**
1. The manager deploys a contract `Puller`.
2. The manager calls `execute(USDG, increaseApproval(Puller, vaultBalance))`. NAV does not change during the call, so `TradeTooLarge` and `LossTooLarge` pass.
3. Outside `execute` (no receipt, no NAV check), `Puller.transferFrom(vault, attacker, balance)` takes 100% of the vault's USDG.

The Shield API does not stop this either. It sees the `Approval` event in simulation, but a *limited* amount to a *contract* spender produces only an `APPROVAL` info finding, so the verdict is **ALLOW** (`shield.ts`, step 3).

**PoC.** `test/poc/vault.poc.test.ts`, "PoC C-01" (uses `PaxosLikeToken`, which copies the mainnet USDG behaviour).

**Fix.**
- Replace the denylist with an allowlist of `(target, selector)` pairs. On token targets allow **only** `approve(spender, amount)` with `allowedSpender[spender]`, and reject every other selector on any address that is the base asset or a tracked asset.
- Routers get their own allowlist of swap selectors.
- As defence in depth, have the vault approve the exact amount and reset the allowance to 0 in the same call. Do this through a vault-internal swap helper rather than leaving standing approvals.

## H-01 (High): the loss limit is per trade, not cumulative

**Description.** `execute` allows any number of calls, and each one may lose up to `maxLossBps` of NAV (up to 3% through the factory, 10% if the owner raises it). The vault has no price-vs-oracle check per trade, no cumulative or rolling drawdown budget, and no rate limit.

A manager can route through a pool it controls: a new Uniswap fee tier, a v4 pool with a hook, or an illiquid pool with `amountOutMin = 0` that it sandwiches. It then captures just under `maxLoss` per trade. The Shield does not detect this: any inflow suppresses `ONE_WAY_OUTFLOW`, and there is no oracle price check. Receipts are issued automatically, last 120 s, and many can be collected in advance, so the drain fits in a few blocks, before a multisig can pause.

**Exploit.** Run 25 swaps of 20% of NAV each, at 86% of fair value. Each call loses 2.8% (under the 3% limit) and is under the 25% size limit. NAV goes from **10,000 to 4,916 USDG**. About 0.97^n of NAV remains after n trades.

**PoC.** `test/poc/vault.poc.test.ts`, "PoC H-01".

**Fix.**
1. Check the execution price per trade against the oracles: `valueIn >= valueOut * (BPS - maxSlippageBps)`, with slippage around 50–100 bps. This uses the same balance deltas that `_outflowValue` already computes, but tracks inflow too.
2. Add a cumulative drawdown budget over a rolling window, for example a 24 h maximum NAV-per-share decline measured from a checkpoint, and auto-pause `execute` when it is hit.
3. Lower the default `maxLossBps`.
4. Optionally add a per-block or per-hour cap on the number of `execute` calls.

## H-02 (High): high-water mark not reset at zero supply

**Description.** `highWaterMark` is an absolute assets-per-share price, initialised to `10**6` per `10**12` shares. While `totalSupply() == 0`, `_harvest` returns early. If the vault holds any residual assets L at that point, the first deposit is priced with the virtual offset: `shares = V * 1e6 / (L + 1)`. The share price therefore jumps by a factor of (L + 1), the depositor keeps their value, and NAV per share is now far above the stale HWM.

The next `harvest()` (callable by anyone, and run first by every later deposit or withdrawal) books the depositor's own principal as "profit":
- L = 1 wei: the share price doubles, and the fee is 7.5% of the deposit.
- L ≥ 1 USDG: the fee is about 15%, the maximum.

L can be a donation (front-run), rounding dust, or an airdrop after a full exit.

**Exploit.**
1. A new factory vault starts with supply 0.
2. The manager sends 1 USDG to it.
3. The first user deposits 9,999 USDG.
4. The manager calls `harvest()`: the manager receives **999.9 USDG** of shares, the platform **499.9 USDG**, and the user is left with **8,499 USDG**, with no trade and no price move.

After a full exit, 1 wei of residual balance is enough to take 375 USDG of a 5,000 USDG deposit.

**PoC.** `test/poc/vault.poc.test.ts`, "PoC H-02" (two tests).

**Fix.**
- In `deposit` and `mint`, record `supplyBefore = totalSupply()`. After `super.deposit` or `super.mint`, if `supplyBefore == 0`, set `highWaterMark = _convertToAssets(10**decimals(), Floor)`.
- Also consider seeding each vault at creation with a small dead-share deposit, so supply never returns to 0.
- Optionally sweep residual assets to the fee recipient when supply is 0.

## M-01 (Medium): `redeemInKind` is not an unconditional exit

**Description.** The emergency exit depends on two things that can fail:

1. **`_harvest()` runs first.** `_tryValueOf` catches only a *revert* of `latestRoundData()`. Several failures are not caught and revert all of `_tryTotalAssets`, and with it `_harvest` and `redeemInKind`:
   - ABI-decoding failures: a feed that returns empty or short data, such as a proxy whose implementation has no code, or a feed address that is an EOA.
   - A revert in `a.feed.decimals()` inside the success block.
   - A revert in a token's `balanceOf`.
   - Overflow in `uint256(answer) * 10**6` or in `mulDiv`.

   Anyone can make the balance non-zero by sending 1 wei, which forces the feed path.
2. **Every tracked asset is transferred in one transaction.** If one tracked token is halted or paused, or blacklists the vault (tokenized stocks and regulated stablecoins can do both), every in-kind exit reverts. No asset can be skipped.

**PoC.** `test/poc/vault.poc.test.ts`, "PoC M-01": a halted token, and `EmptyReturnFeed`.

**Fix.**
- Do not call `_harvest` from `redeemInKind`, or call it through a self-call wrapped in `try`.
- In `_tryValueOf`, use a low-level `staticcall` with a `returndata.length >= 160` check, and cache the feed decimals at `addAsset`. Bound `answer` and use checked math inside the try path (return `false` on failure).
- Add `redeemInKind(shares, receiver, owner, address[] skip)`, so a user can forgo a frozen asset whose share stays with the remaining holders, or wrap each transfer in `try` with an explicit opt-in.

## M-02 (Medium): a dead feed bricks the vault; feeds cannot be replaced

**Description.** There is no `setFeed`. `_addAsset` rejects tokens that are already enabled. `removeAsset` requires `balanceOf == 0`, and the manager cannot sell the asset to reach zero because `execute` calls `totalAssets()`, which reverts with `StalePrice`. So if a feed stops updating, or is migrated to a new address, while the vault holds the asset:
- deposits, base-asset withdrawals, redemptions and all trading stop **permanently**;
- the only exit left is in-kind (itself fragile, see M-01);
- the vault must be abandoned.

Separately, anyone can block `removeAsset` of an unused asset by sending 1 wei of it.

**PoC.** `test/poc/vault.poc.test.ts`, "PoC M-02" (two tests).

**Fix.**
- Add an owner `setFeed(token, feed, heartbeat)`, behind a timelock.
- Let `removeAsset` proceed when the balance is below a dust threshold, or force-remove (balance becomes untracked) after a timelock.
- Consider letting withdrawals value a stale asset at 0 (conservative for remaining holders) and blocking only deposits.

## M-03 (Medium): approvals cannot be revoked once a spender is de-listed

**Description.** The spender check also applies to `approve(spender, 0)`. Once the owner de-lists a router, for example because it was compromised, the open, often unlimited, allowance stays in place. Neither the manager nor the owner can revoke it. The owner has no direct revoke function and cannot call `execute`. Standing unlimited approvals are the normal pattern here (the tests approve 1,000,000 USDG).

**PoC.** `test/poc/vault.poc.test.ts`, "PoC M-03".

**Fix.**
- Always allow `approve(x, 0)` and the Permit2 `approve(token, x, 0, 0)`.
- Add `revokeApproval(token, spender)` for the owner (no receipt needed) that only sets the allowance to 0.
- In `setSpender(spender, false)`, revoke for all tracked assets and the base asset.

## M-04 (Medium): Signals withdrawal delay can be pre-armed

**Description.** `requestWithdraw` starts the timer, and `withdraw` can then be called at any time after `withdrawableAt`, indefinitely.

**Exploit.**
1. On day 0 the payer requests a withdrawal of the full balance.
2. Days later, a provider sees `balanceOf = 100` and serves calls against vouchers.
3. The payer calls `withdraw()` immediately, or front-runs the provider's `redeem`, and the voucher reverts with `InsufficientBalance`.

The stated property ("accepted vouchers remain redeemable") does not hold unless every provider also watches `pendingWithdrawal` and `withdrawableAt`.

**PoC.** `test/poc/signals.poc.test.ts`, "PoC M-04".

**Fix.**
- Give a request an execution window that expires (for example, `withdrawableAt ≤ now ≤ withdrawableAt + 1 day`).
- Expose `spendable(payer) = balanceOf - pendingWithdrawal` and document that providers must check it, or reject new vouchers (off-chain) for pending payers.
- Alternatively, let a fresh `fund` or voucher redemption reset the timer.

## M-05 (Medium): `pay()` has no price bound

**Description.** `pay` charges `pricePerCall * calls` at the *current* price, and the provider can change the price at any time through `update`. Agents typically grant large or infinite allowances. A provider can front-run a `pay` transaction and charge any amount up to the payer's allowance and balance. In the PoC, 1 USDG becomes 1,000 USDG.

**PoC.** `test/poc/signals.poc.test.ts`, "PoC M-05".

**Fix.** Add a `maxAmount` (or `expectedPrice`) parameter and `require(amount <= maxAmount)`. Optionally put price increases behind a delay.

## M-06 (Medium): oracle-latency arbitrage at NAV

**Description.** Deposits and base-asset withdrawals settle instantly at the oracle NAV. Feeds for tokenized equities update by heartbeat and deviation and freeze outside market hours, while the tokens trade around the clock. Anyone who sees the real price move ahead of the feed can:
- withdraw USDG at a stale-high NAV before a feed drop, or
- deposit at a stale-low NAV before a rise and withdraw after it.

Each time, remaining holders lose up to the feed's deviation threshold, or more around weekends and halts. There is also no L2 sequencer-uptime check (Robinhood Chain is an Arbitrum Orbit L2): after an outage, prices that are stale but within the heartbeat are accepted.

**Fix.**
- Add an entry/exit fee of at least the feed deviation, or asynchronous ERC-7540-style requests settled at the next feed update.
- Block deposits when any held asset's feed is older than X, or when the market is closed.
- Add a sequencer-uptime feed with a grace period.
- Use short heartbeats.

## L-01 (Low): the NAV check is blind to deferred effects and liabilities

`execute` compares NAV only before and after one call. Anything that moves value later is invisible: pre-signed orders (CoW `setPreSignature`, limit orders), lending debt (borrowed tokens count as assets and the debt as nothing, which also inflates fees), LP or staking receipts (valued at 0), and multicall-capable tokens.

**Fix:** keep the target allowlist to pure swap routers, document this as a hard rule for `setDefaults` and `setTarget`, and combine it with C-01's selector allowlist.

## L-02 (Low): fee silently skipped on a stale feed

When `_tryTotalAssets` fails, `_harvest` returns without doing anything:
- `redeemInKind` during a stale period exits without paying the performance fee that has built up.
- `setManager` hands the fee to the *new* manager.

**Fix:** have `setManager` revert if harvest cannot run (or carry the old manager's entitlement forward), and accept fee avoidance by in-kind exit as a documented trade-off.

## L-03 (Low): ERC-4626 view functions revert

`maxWithdraw`, `maxRedeem`, `previewRedeem` and `convertTo*` revert on a stale feed. EIP-4626 requires `max*` not to revert, and integrators and aggregators will break.

**Fix:** return 0 from `max*` when `_tryTotalAssets` fails, as `maxDeposit` already does.

## L-04 (Low): voucher balance is shared across signals

A payer's single balance backs vouchers for every signal, so the total of outstanding vouchers can exceed it. Providers race, and one provider cannot know about another's vouchers. `redeem` is all-or-nothing: if the balance is short, nothing is paid, even though a partial amount is available.

**Fix:** use per-signal (or per-provider) escrow sub-balances, or allow a partial redeem that pays `min(amount, balance)` and records only what was paid.

## L-05 (Low): owner model

The vault uses `Ownable` (one step), while the factory and Signals use `Ownable2Step`. Without a timelock, the owner can add any Shield signer, target, spender or asset feed, which amounts to full control over NAV and the outflow rules. This is acceptable only for a multisig that is trusted.

**Fix:** use `Ownable2Step`, and put a timelock on `setShieldSigner`, `addAsset`, `setTarget`, `setSpender` and `setLimits` (loosening only).

## I-01 to I-06

- **I-01: Receipts are not bound to the manager or a nonce.** The Shield signs a receipt for any `from` address that anyone submits. Receipts stay valid across `setManager` for their TTL. This is harmless only because `execute` is `onlyManager`.
  - Optional: add a `vaultNonce` or the manager address to the struct.
- **I-02: `redeemInKind` uses the real supply.** It ignores the virtual `10**6` shares and assets, so a redeemer gets about `1e6/supply` more than `convertToAssets`. This is negligible at real supply, and is noted for consistency.
- **I-03: Some tokens are stranded.** Tokens that arrive after `removeAsset`, or untracked tokens the manager buys (valued at 0, and if the token is not a target they cannot be approved and sold), are not distributed by `redeemInKind` and stay stuck.
  - Add an owner sweep-to-holders or a re-track path.
- **I-04: Factory and deployer config is unchecked.** `setDefaults` does not validate: more than 16 assets, `token == baseAsset`, or a zero feed makes every `createVault` revert. `setCaps` has no upper bound (the vault still caps loss at 10%). The factory constructor does not check that `deployer.factory() == address(this)`. Anyone can create vaults with look-alike names; the front end must rely on `isVault` together with curated metadata.
- **I-05: The deploy script cannot run.** In `scripts/deploy.ts`, `const [deployer] = …` and then `const deployer = await viem.deployContract(...)` in the same scope is a SyntaxError.
- **I-06: Signals minor points.**
  - `fee = amount * feeBps / BPS` rounds to 0 for amounts under 10 units (negligible in value).
  - `setFee` changes the split for vouchers that were already signed.
  - Payers using EIP-1271 can make accepted vouchers invalid by rotating keys. Providers should prefer EOA payers or redeem promptly.

---

## Fix status (2026-11-23 UTC)

Every PoC above was converted into a regression test (`test/poc/*.poc.test.ts`) that now requires the attack to fail. Property-based fuzz tests were added in `test/fuzz/HeimdallFuzz.t.sol` (256 runs each). Slither reports are in `reports/`; remaining items are by-design (guarded external call in `execute`, intentional `supply == 0` checks) or inside OpenZeppelin `Math`.

| ID | Status | Fix |
|---|---|---|
| C-01 | Fixed | Denylist replaced with an allowlist. On the base asset and tracked tokens only `approve(spender, amount)` is accepted, with `spender` allowlisted or `amount == 0`. Any other target needs an explicit `(target, selector)` pair set by the owner (`setCall`). The Shield API also decodes `increaseApproval` and `approveAndCall` as approvals. Fuzz: `testFuzz_tokenCallsCannotGrantAllowance`, `testFuzz_unknownTargetsRevert`. |
| H-01 | Fixed | Rolling 24h loss budget: `maxDailyLossBps` (factory default 5%, hard cap 15%, never below the per-trade limit). The window starts at the first trade after expiry and accumulates every NAV drop caused by `execute`. |
| H-02 | Fixed | The high-water mark is reset to the post-deposit share price whenever supply was 0 before a `deposit`/`mint`, and to 1.0 when the last share is burned in kind. Fuzz: `testFuzz_noFeeOnDonation`. |
| M-01 | Fixed | `redeemInKind` harvests through a self-call wrapped in try/catch. Feed reads are low-level staticcalls (malformed data counts as stale), and the feed's decimals are cached at configuration time. `redeemInKindExcept(shares, receiver, owner, skip[])` leaves halted tokens behind. |
| M-02 | Fixed | `setFeed(token, feed, heartbeat)` for the owner. |
| M-03 | Fixed | `approve(x, 0)` is always allowed, and the owner can call `revokeApproval(token, spender)`. |
| M-04 | Fixed | `available(payer) = balance − pendingWithdrawal` is excluded at once (the SDK's `verifyVoucher` uses it), and a request must be executed within 3 days after the delay or it expires. |
| M-05 | Fixed | `pay(id, calls, requestId, maxPricePerCall)`. |
| M-06 | Mitigated | The 10,000 USDG per-vault deposit cap bounds oracle-lag arbitrage during the guarded launch. Robinhood Chain sequencer-uptime feed: add when one is published. |
| L-01 | Mitigated | The allowlist leaves no path to deferred-effect calls (orders, lending, LP). Only reviewed swap selectors are allowed. |
| L-02 | Accepted | A fee skipped during a stale feed is collected at the next harvest when the price is fresh. |
| L-03 | Fixed | `maxWithdraw`/`maxRedeem` return 0 instead of reverting while a feed is stale. |
| L-04 | Documented | Providers check `available` and redeem regularly (documented in the Signals docs). |
| L-05 | Fixed (2-step) | The vault uses `Ownable2Step`. The owner is a multisig; a timelock is planned when caps are raised. |
| I-04 | Fixed | The factory validates caps, default calls and assets, and emits events for every change. |
| I-05 | Fixed | `scripts/deploy.ts` runs. |
| I-01, I-02, I-03, I-06 | Accepted | Informational. |

$HEIM utilities added in the same pass: the vault halves the platform fee (5% → 2.5%) when the manager holds `holderMin` HEIM; Signals charges `holderFeeBps` (5%) when the payout wallet holds it. Both read the balance with a staticcall that fails closed (no discount) and can never revert a payment or harvest.

Bytecode (runtime): Vault 16,369 B and Deployer 21,987 B (viaIR, runs = 1, both under 24,576); Factory ≈6.5 KB; Signals ≈9.8 KB.

## Slither on the contracts added on 2026-11-23

HeimdallPay, HeimdallStaking, HeimdallFeeSplitter and HeimdallStockFeed (reports in `reports/slither-*.txt`):

| Finding | Assessment |
| --- | --- |
| Timestamp comparisons (deadlines, review windows, reward periods) | Intended; windows are hours to days, far above any sequencer drift. |
| Multiplication after division (Pay `resolve`, Staking `notifyReward`) | Rounding of at most 1 raw unit. The conservation fuzz property (Pay) and the solvency property (Staking) hold. |
| Strict equality on zero (`totalStaked == 0`, empty balance) | Intended guards, not price checks. |
| Reentrancy in `HeimdallFeeSplitter.distribute` | Fixed: `nonReentrant` added; the staking target is set only by the Safe. |
