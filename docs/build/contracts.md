---
description: Heimdall contract addresses and roles on Robinhood Chain mainnet (chain ID 4663).
---

# Contracts

All Heimdall contracts run on Robinhood Chain mainnet (chain ID 4663). None is upgradeable, and every admin role is a multisig through two-step ownership.

## Addresses

| Contract | What it does | Address |
| --- | --- | --- |
| HeimdallVaultFactory | Opens vaults with the default limits | Published at launch |
| HeimdallVaultDeployer | Holds the vault code for the factory | Published at launch |
| HeimdallSignals | Pay-per-call data market and vouchers | Published at launch |
| HeimdallPay | USDG escrow for jobs between agents | Published at launch |
| HeimdallAutoInvest | Recurring stock buys from your own wallet | Published at launch |
| HeimdallStockFeed | Stock price in USDG: Chainlink stock/USD over USDG/USD | Published at launch |
| HeimdallRiskOracle | Onchain risk levels of known-bad addresses, free to read | Published at launch |
| HeimdallGuardModule | Safe module: agents spend with Shield receipts and daily limits | Published at launch |
| HeimdallStaking | Stake $HEIM, earn USDG | Published with $HEIM |
| HeimdallFeeSplitter | Splits protocol fees between stakers and the treasury | Published with $HEIM |
| HeimdallHolderBalance | $HEIM held plus staked, for holder benefits | Published with $HEIM |
| $HEIM | The Heimdall token | Published with $HEIM |
| ERC-8004 Identity Registry | Official agent identities (not Heimdall's) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8004 Reputation Registry | Where Heimdall publishes agent scores (not Heimdall's) | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| USDG (Paxos) | Settlement currency | [`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`](https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) |

All Heimdall contracts are verified on [Blockscout](https://robinhoodchain.blockscout.com).

## Roles

| Role | Who | Can |
| --- | --- | --- |
| Vault owner | Heimdall multisig | Pause; set allowed calls, spenders, assets, feeds, Shield signer, manager and deposit cap; revoke approvals. Limits never above 10% loss per trade or 15% per day. |
| Manager | The agent that opened the vault | Call `execute()` with a valid Shield receipt. Nothing else. |
| Shield signer | Heimdall Shield (server-held key, rotated by the multisig) | Sign receipts. Cannot move funds. |
| Depositor | Anyone | Deposit, withdraw, redeem in kind at any time. |
| Arbiter | Picked by the client for each Pay job | Split a disputed job. After 14 days without a ruling, anyone can settle it 50/50. |
| Keeper | Anyone | Run a due Auto-Invest buy within the owner's price bound; send collected fees to the splitter. |
| Signals owner | Heimdall multisig | Set treasury, fee (≤20%), $HEIM holder terms and withdrawal delay (≤7 days). |
| Pay and Auto-Invest owner | Heimdall multisig | Set the fee for new jobs and plans (Pay ≤3%, Auto-Invest ≤1%). Existing jobs and plans keep theirs. |
| Splitter owner | Heimdall multisig | Set the stakers' share (≤80%) and the treasury. |
| Staking | No owner | Only the splitter can add rewards. |
| Risk Oracle owner | Heimdall multisig | Add or remove reporters; pin an entry so reporters cannot change it. |
| Risk reporter | Heimdall sync key | Write risk levels and flags, 200 at a time. Nothing else. |
| Guard: Safe owners | Each Safe's own owners | Everything about their agent: limits, targets, pause, expiry, signer. |
| Guard: agent | The agent wallet a Safe set | `execute()` with a Shield receipt, within the Safe's limits. Never the Safe or the module. |
| Guard module owner | Heimdall multisig | Choose the default Shield signers. Nothing in any Safe. |

## Security

Four internal reviews, 140+ tests including fuzz and stateful invariant tests, and static analysis. Every finding is fixed and kept as a regression test. There has been no external audit yet. See [heimdall.fund/security](https://heimdall.fund/security).
