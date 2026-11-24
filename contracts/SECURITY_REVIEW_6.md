# Heimdall contracts: security review 6 (pre-deployment)

**Date.** 2026-11-24 (UTC). **Scope.** Every contract in `contracts/` as it will be deployed to Robinhood Chain mainnet, the deploy script and the deploy config, with reviews 1 to 5 applied. **Method.** A fresh Slither run on every contract; a line-by-line read of each contract looking for ways value can leave without the limits seeing it; a PoC for every suspected issue (`test/poc6/`); the full suite, the mainnet-fork tests against the real Uniswap router and Chainlink feeds, a deploy dry run on a mainnet fork, and the deep fuzz and invariant profile.

```
npx hardhat test                                          # 156 passing (76 Solidity, 80 node)
npm run test:deep                                         # fuzz at 10,000 runs, invariants at 512 × 200: all pass
FORK=1 npx hardhat test nodejs test/fork/*.ts             # real USDG, NVDA, SwapRouter02 and feeds: pass
npm run deploy:dry                                        # full deploy on a mainnet fork: pass
npm run size                                              # Vault 17,137 bytes, Deployer 22,924 bytes (1,652 left)
```

**Verdict.** No Critical issue. One High and one Low, both fixed with regression tests. One suspected issue was ruled out with a test. The contracts are ready to deploy; the operational points at the end matter as much as the code.

## Findings

| ID | Severity | Where | Title | Status |
| --- | --- | --- | --- | --- |
| R6-01 | High | `HeimdallVault` | Swap output could be sent to anyone: the vault never checked the router call's `recipient` | **Fixed** |
| R6-02 | Low | `HeimdallFeeSplitter` | Anyone could still stretch the stakers' 7-day stream with 2 raw units of USDG, because `distribute` is open | **Fixed** |
| R6-03 | – | `HeimdallRiskAware` | Starving the oracle read of gas to slip a blocked address through | **Not exploitable** (test kept) |

### R6-01: swap output to the manager

The vault allowlists router selectors (`exactInputSingle`, `exactInput`), but never looked inside the call. A manager holding a Shield ALLOW receipt could set `recipient` to its own address: the vault only saw a drop in NAV, which passes as long as it fits the per-trade and daily loss limits. That is up to the daily limit (3% with the deploy config) every day, sent straight to the manager. Shield flags such a swap (`ONE_WAY_OUTFLOW`, a WARN, which a vault refuses), so exploiting it needs Shield to be wrong or the signer key to leak. But the vault's promise is that the manager can never withdraw depositor funds, whatever Shield says.

**PoC.** `test/poc6/VaultRecipientPoc.t.sol`: before the fix, a 2,900 USDG `exactInputSingle` and an `exactInput` with `recipient = manager` both went through.

**Fix.** For SwapRouter02's `exactInputSingle`, `exactOutputSingle`, `exactInput`, `exactOutput`, `swapExactTokensForTokens` and `swapTokensForExactTokens`, the vault reads the recipient from the calldata and accepts only the vault itself or `address(1)` (the router's MSG_SENDER, which is the vault). `address(2)` (the router itself) is refused: anyone could sweep it. `multicall` can never be allowlisted, so no recipient can hide inside one. The mainnet-fork test now also proves that a small payout to a third party, which used to fit inside the loss limit, is refused, while normal swaps on the real router still work.

### R6-02: dust restarts of the staking stream

Review 2 restricted `HeimdallStaking.notifyReward` to the splitter, but `HeimdallFeeSplitter.distribute` is permissionless. Sending 2 raw units of USDG and calling it restarts the 7-day stream; done hourly for a week, a staker who should earn 7,000 USDG in that week earns 4,433 (37% pushed past the week to later stakers).

**Fix.** The splitter passes USDG to stakers at most once a day (`STAKER_INTERVAL`, the keeper's own pace). A call in between does nothing and the USDG waits for the next payout. Regression test: `test/poc6/SplitterStretchPoc.t.sol`.

### R6-03: gas-starving the Risk Oracle read (ruled out)

`HeimdallRiskAware.notBlocked` reads the oracle with a 30,000-gas staticcall, and with `failClosed = false` a failed read counts as not blocked. Starving the read is the usual attack, but the read costs about 5,000 gas: to make it fail, the caller must leave so little that only 1/64 of it (under 100 gas) is left afterwards, and no gated function can finish on that. `test/poc6/RiskAwareGasPoc.t.sol` sweeps every gas amount from 3,000 to 80,000 and a blocked caller never gets in.

## Reviewed and held

- **Shield receipts.** EIP-712 with the chain ID; each receipt names the vault or Safe that executes it, the exact target, data hash and value; ALLOW only; expiry; one use per check ID; malleable signatures rejected.
- **Vault accounting.** ERC-4626 with a 6-decimal virtual offset (no inflation attack), fee-aware previews, the high-water mark reset at zero supply, and in-kind exits that work while paused or with a stale feed.
- **Vault trading.** Allowlisted selectors, tokens only `approve` to allowlisted spenders, per-trade size and loss, a daily loss budget, and now the recipient check. Reentrancy from a target into the vault is blocked.
- **Pay.** Each escrow pays out exactly once; a frozen address is paid later through `withdrawOwed`; disputes time out to a 50/50 split.
- **Signals.** Cumulative vouchers per payer and signal, EIP-712 with chain ID and contract, ERC-1271 wallets supported, a withdrawal delay that protects vouchers already accepted, and a price bound on direct payments.
- **Auto-Invest.** The keeper cannot change the amount or the recipient, and the fill must be within the user's bound of the oracle price.
- **Guard module.** CALL only, never to the Safe or the module; limited tokens counted by balance before and after the call.
- **Stock feed and Risk Oracle.** Fail closed on a paused stock oracle, a corporate action, or a stale or off-peg USDG quote; pinned oracle entries cannot be changed by reporters.
- **Deploy script.** It checks the chain, that the Safe exists and that every feed is fresh, deploys with the deployer as temporary owner, starts a 2-step handover to the Safe and verifies it, and writes the Safe batch that accepts ownership.

## Operational points (not code)

1. **The admin Safe owns every vault and can change its manager, Shield signer and limits.** With one signer, a stolen owner key could appoint itself manager and lose up to the daily limit (at most 15%) per day. Add a second signer, ideally a hardware wallet, before raising the 10,000 USDG per-vault deposit cap.
2. **The Shield signer key is held in an environment variable**, not in a KMS. A leaked key lets a rogue manager skip Shield, but not the onchain limits, which now include the recipient check. Move to a KMS key later with a Safe rotation (`OP=signer`); no redeploy is needed.
3. **The deployer key is used once.** After the Safe accepts ownership it controls nothing; the leftover ETH can pay gas for the monitor and the x402 facilitator.
