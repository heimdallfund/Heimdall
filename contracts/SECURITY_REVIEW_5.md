# Heimdall contracts: security review 5

**Date.** 2026-11-24 (UTC). **Scope.** `HeimdallGuardModule`, `HeimdallVault` and `HeimdallVaultFactory` after review 4, plus the monitor job that acts on vault losses. **Method.** Attack-first review of how value can leave a Safe or a vault without the limits seeing it, with PoCs in `test/poc5/`.

**Verdict.** No Critical issue. One Medium in the guard module and one Medium design gap in the vault, both fixed with regression tests.

## Findings

| ID | Severity | Where | Title | Status |
| --- | --- | --- | --- | --- |
| R5-01 | Medium | `HeimdallGuardModule` | A limited token could leave the Safe through an allowance given earlier (a router pulling from its caller), and the daily limit did not count it | **Fixed** |
| R5-02 | Medium | `HeimdallVault` | A rogue manager whose trades Shield approves can lose up to the daily loss limit every day; nothing onchain stopped it until the Safe acted | **Fixed** (guardian) |

### R5-01: limited tokens leaving through an existing allowance

The module counted direct token calls (`transfer`, `approve`, `transferFrom` from the Safe). A call to a router that pulls the Safe's tokens with an allowance the owners gave earlier moved the token without touching the limit.

**Fix.** The module now reads the Safe's balance of every limited token before and after each agent call and counts whatever left, by any path. Approvals still count in full when given, except approvals to an allowlisted target, whose pulls are measured when they happen. A Safe can limit at most 16 tokens (`MAX_LIMITED_TOKENS`). Regression tests: `test/poc5/GuardPoc.t.sol`, guard invariant.

### R5-02: a manager can lose the daily budget every day

A self-sandwich looks clean when Shield simulates the trade alone. The vault's per-trade and daily loss limits bound it to a few percent per day, but it could repeat daily until the owner Safe replaced the manager.

**Fix.** Vaults have a `guardian` (set by the factory on every new vault) that can only `pause`: trading and deposits stop, withdrawals and in-kind exits keep working, and only the owner can unpause. The monitor holds the guardian key and pauses a vault when a single trade loses 1.5% of NAV or 60% of the day's loss budget is used. The default caps are also tighter: 2% per trade, 3% per 24 h. Regression tests: `test/poc5/VaultPoc.t.sol`, `apps/monitor/test/rules.test.ts`.
