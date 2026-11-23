# Heimdall contracts: security review 3

**Date.** 2026-11-23 (UTC). **Scope.** All contracts in `contracts/`, as they stand after the fixes from reviews 1 and 2 and the AutoInvest review. **Method.** Fresh Slither run on every contract, a new layer of stateful invariant tests (random sequences of up to 200 actions, 512 sequences per property in the `deep` profile), all fuzz properties at 10,000 runs, and a check of the production build.

```
npx hardhat test                                   # 112 passing
npm run test:deep                                  # every fuzz property at 10,000 runs, every invariant at 512 × 200
npm run size                                       # production build, EIP-170 check
```

**Verdict.** No Critical, High or Medium issue. Two Low findings, both fixed with regression tests. One of them would have blocked the mainnet deployment.

## Findings

| ID | Severity | Where | Title | Status |
| --- | --- | --- | --- | --- |
| R3-01 | Low (deploy blocker) | `hardhat.config.ts` | The production build profile dropped the size overrides, so `HeimdallVaultDeployer` compiled to 25,620 bytes, over the EIP-170 limit of 24,576 | **Fixed** |
| R3-02 | Low | `HeimdallVault` | `maxWithdraw`, `maxRedeem` and every `preview*` ignored a pending performance fee: `withdraw(maxWithdraw)` reverted and `previewRedeem` overstated the payout | **Fixed** |

### R3-01: production build over the contract size limit

Hardhat 3 builds deployments with the `production` profile. When the config only sets `compilers` and `overrides` at the top level, Hardhat generates that profile itself, and the `viaIR` / `runs = 1` overrides for `HeimdallVault.sol` and `HeimdallVaultDeployer.sol` were not applied. The deployer then embeds an 18,972-byte vault and comes to 25,620 bytes. The tests use the `default` profile, where it is 22,243 bytes, so no test could see it.

**Impact.** Deploying the deployer to Robinhood Chain would fail (or, on a chain that raised the limit, the verified source would not match the tested build).

**Fix.** Both profiles are declared explicitly with the same compilers and overrides. New `npm run size` builds the production profile and fails if any contract is over 24,576 bytes; `npm run deploy` runs it first, and both deploy scripts pin `--build-profile production`. Current sizes: deployer 22,243 bytes (2,333 left), vault 16,606.

### R3-02: ERC-4626 views ignored the pending fee

`deposit`, `mint`, `withdraw` and `redeem` first call `_harvest()`, which mints fee shares when the share price is above the high-water mark. The views (`previewDeposit`, `previewMint`, `previewWithdraw`, `previewRedeem`, `maxWithdraw`, `maxRedeem`) used the supply *before* those shares exist.

**Impact.** With a fee pending: `withdraw(maxWithdraw(user))` reverts with `ERC4626ExceededMaxWithdraw`, so a "Max" button or an integrator fails; `previewRedeem` promises more than `redeem` pays, which breaks the ERC-4626 rule that previews must not overstate. No funds are at risk: the state-changing calls were always correct.

**Found by.** The new vault invariant handler, calling `withdraw(maxWithdraw)` in random states.

**Fix.** One function, `_pendingFee(supply, nav)`, computes the fee shares a harvest would mint. `_harvest` mints exactly that, and `_convertToShares`, `_convertToAssets`, `maxWithdraw` and `maxRedeem` use the supply including it. Previews now match the state-changing calls to the unit. The high-water mark is set from the raw share price, so a donation into an empty vault still earns no fee (V-5 still passes).

**Regression.** `test/fuzz/Vault4626Fuzz.t.sol`: `withdraw(maxWithdraw)` and `redeem(maxRedeem)` never revert, and `previewRedeem` / `previewDeposit` equal what the call does. `testFuzz_previewsExact` fails on the old code.

## New invariant tests (`test/invariant/`)

Each handler drives the contract through random sequences of every user action plus time jumps. `failOnRevert` is on, so an unexpected revert also fails the run. Each handler was checked with a deliberately failing probe to confirm it reaches the states that matter (jobs created, payouts deferred, hostile trades accepted).

| Contract | Handler actions | Invariants |
| --- | --- | --- |
| HeimdallPay | create, submit, release, dispute, refund, cancel, claim, resolve, expired-dispute settle, withdrawOwed, warp, **USDG freeze/unfreeze of any party** | balance = live escrow + `totalOwed`; `totalOwed` = Σ `owed`; in − out = balance |
| HeimdallStaking + FeeSplitter | stake, withdraw, claim, exit, distribute fees, warp | HEIM held = `totalStaked` = Σ stakes; USDG held ≥ Σ `earned` + `unassigned`; claimed ≤ distributed |
| HeimdallSignals | fund, requestWithdraw, withdraw, redeem vouchers (including lower, replayed and over-balance ones), warp | USDG held = Σ balances; no payer charged above the highest voucher signed; funded = held + withdrawn + paid out |
| HeimdallVault | deposit, withdraw(max), redeem(max), redeemInKind, manager trades **including hostile ones that send the output to the manager**, price moves ±5%, harvest, warp | shares never claim more than NAV; theft by a compromised manager **with a compromised Shield signer** stays within the 5% daily loss limit of the window's NAV; every holder can always exit in kind and receives something |

The vault result answers audit question Q-3 empirically: even with every Shield receipt granted, a hostile manager could not extract more than `maxDailyLossBps` of NAV per 24 h window in 512 × 200 random actions.

## Slither (re-run, all contracts)

No new finding. Every result is either in OpenZeppelin (`Math.mulDiv` "incorrect-exp", `invMod`), already triaged in reviews 1 and 2, or by design:

- `HeimdallVault.execute` reentrancy-balance: the vault reads balances before and after the external call on purpose, to measure the trade. The function is `onlyManager` + `nonReentrant`, and every deposit and exit function is `nonReentrant` too.
- `HeimdallPay` reentrancy-no-eth on `_release` / `resolve` / `settleExpiredDispute`: state is written before any transfer, every entry point is `nonReentrant`, and the token is the immutable USDG.
- `HeimdallAutoInvest` arbitrary-send-erc20: by design (KNOWN_ISSUES A-04).
- Strict equalities and divide-before-multiply in fee and reward math: checked; remainders always go to the user side.

## Not covered

The same limits as before: no formal verification, no test against the real Uniswap pools beyond the fork tests, and no review of the $HEIM token (launched separately). An external audit is still recommended before the vaults and staking hold user funds.
