# Heimdall contracts: security review 4

**Date.** 2026-11-23 (UTC). **Scope.** The new integration layer: `HeimdallRiskOracle`, `HeimdallRiskAware`, `interfaces/IHeimdallRisk`, `HeimdallGuardModule` (Safe module), plus the off-chain pieces they depend on: the x402 facilitator and paywall in the Shield API, the Agent Passport (ERC-8004) linking and score publishing, and the monitor's oracle sync. **Method.** Line-by-line review, Slither on each new contract, end-to-end tests against a real Safe 1.4.1, a mock EIP-3009 USDG and mock ERC-8004 registries (ABIs checked against the live registries on Robinhood Chain), a local chain with chain ID 4663 for the paywall, and a new stateful invariant for the guard.

```
npx hardhat test                                   # 143 passing (63 Solidity, 80 node)
npm run test:deep                                  # fuzz at 10,000 runs, invariants at 512 × 200
npm run size                                       # GuardModule 8,190 bytes, RiskOracle 3,558 bytes
```

**Verdict.** No Critical or High issue. One Medium and one Low in code that holds or moves money (guard module, x402 paywall), one Low in the sync job. All three fixed with regression tests.

## Findings

| ID | Severity | Where | Title | Status |
| --- | --- | --- | --- | --- |
| R4-01 | Medium | `HeimdallGuardModule` | A token with a daily limit could still be moved through calls the limit does not count (`transferAndCall`, `burn`, permit-style or unknown functions) | **Fixed** |
| R4-02 | Low | Shield API, x402 paywall | Settlement was idempotent per payment, so one signed payment could pay for many API calls | **Fixed** |
| R4-03 | Low | Monitor, oracle sync | Pinned entries were re-sent on every sync; the oracle skips them, so the reporter paid gas for nothing, forever | **Fixed** |

### R4-01: uncounted token calls through the guard

`_checkTokenCall` counted `transfer`, `approve`, `increaseAllowance` and `transferFrom` (from the Safe) against the token's daily limit, and let every other selector through. On a limited token that also implements `transferAndCall` (ERC-677), `send` (ERC-777), `burn`, or a custom move function, an agent with a valid Shield receipt could move the Safe's tokens without touching the limit.

**Impact.** The daily limit, the main promise of the module, could be bypassed for some tokens. It still needed a Shield ALLOW receipt for the exact call, so this was not open to anyone, but the guard must hold even if Shield is wrong.

**Fix.** A token with a limit only accepts the calls the limit can count; anything else reverts with `TokenNotAllowed`. `decreaseAllowance` stays free (it only lowers what can be taken). `setApprovalForAll(true)` is refused on limited tokens and in strict mode.

**Regression.** `test_limitedTokenOnlyTakesCountableCalls`; the new invariant `invariant_spentWithinLimit` and `invariant_lossBoundedByLimits` (`test/invariant/GuardInvariant.t.sol`), which drive transfers, approvals, pulls and ETH sends through a real Safe in random sequences and check that the Safe never loses more than the limits per window.

### R4-02: one x402 payment, many calls

The facilitator's `settle` is idempotent on purpose (a retried settle must not fail). The paywall used it directly, so a client could send the same `PAYMENT-SIGNATURE` header again and again: the first request settled, every later one got "already settled" and was served.

**Impact.** Paid Shield calls for the price of one. No funds at risk.

**Fix.** Before settling, the paywall claims the payment with an atomic counter (`x402:consumed:<from>:<nonce>`). Only the first request gets 1 and is served; any concurrent or later request with the same payment gets a 402 `payment_already_used`. If settlement fails, the claim is released so the client can retry.

**Regression.** `test/x402/shield-paywall.test.ts` replays the same header and fires two requests at once: the results are exactly one 200 and one 402.

### R4-03: pinned entries re-sent forever

The owner (the Safe) can pin an entry so the reporter can never change it. The monitor computed the diff without knowing about pins, so a pinned address that differs from Shield's list was re-sent on every run. The contract skipped it correctly, but each run cost gas.

**Fix.** `riskDiff` reads `isPinned` and drops pinned entries before reporting.

**Regression.** `test/oracle/sync.test.ts` ("adds, changes, clears and leaves pinned entries alone").

## What was checked and holds

- **Guard: who can do what.** Configuration is keyed by `msg.sender`, so only the Safe itself (through its owners) can change its agents, limits, targets, pause or signer. The agent can never call the Safe or the module (`to == safe`, `to == module` revert), so it cannot add owners, enable modules or raise its own limits. Calls are `CALL` only, never `DELEGATECALL`.
- **Guard: receipts.** Each call needs a fresh EIP-712 Shield receipt bound to the Safe (as `agent`), target, calldata hash and value, used once. A Safe can point at its own signer with `setSignerOverride`.
- **Guard: limits.** Fixed 24 h windows per Safe and asset. ETH is counted on `value`; approvals count in full, so an unlimited approval is impossible on a limited token. A failed inner call reverts the whole execution, so no spend is recorded for it.
- **Oracle.** Only the reporter writes, at most 200 entries per call, and never over a pinned entry. Only the owner sets the reporter and pins. The level is capped at 3.
- **RiskAware.** The oracle read is a `staticcall` capped at 30,000 gas, so a broken or hostile oracle cannot grief the caller. What happens when the read fails is the integrator's choice (`failClosed`), fixed at deploy.
- **x402 verify.** Checks network, scheme, asset, recipient, amount, signature, time window (at least 6 seconds left) and the payer's balance, and refuses any recipient on Heimdall's blocklist.
- **Passport.** A wallet is linked to an ERC-8004 identity only if the registry says it owns that identity or set it as the agent wallet. The score published to the Reputation Registry comes from a separate publisher key, so it is never self-feedback.

## Slither

Reports in `reports/slither-Heimdall{RiskOracle,RiskAware,GuardModule}.txt`. No real finding:

- Timestamp comparisons in the oracle views and the guard windows: by design, a few seconds of drift do not matter for a 24 h window.
- "Costly operations in a loop" in `HeimdallRiskOracle._set`: the batch is capped at 200.
- "Uninitialized local variables" in `_checkTokenCall` (`amount`, `moves`): zero is the intended starting value.
- Low-level call in `HeimdallRiskAware`: the gas-capped `staticcall` described above.
