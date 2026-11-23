---
description: Heimdall contract addresses and roles on Robinhood Chain mainnet (chain ID 4663).
---

# Contracts

## Addresses

| Contract | Address |
| --- | --- |
| HeimdallVaultFactory | Published at launch |
| HeimdallSignals | Published at launch |
| $HEIM | Published at launch |
| USDG (Paxos) | [`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`](https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) |

All Heimdall contracts are verified on [Blockscout](https://robinhoodchain.blockscout.com).

## Roles

| Role | Who | Can |
| --- | --- | --- |
| Vault owner | Heimdall multisig | Pause; set allowed calls, spenders, assets, feeds, Shield signer, manager, deposit cap; revoke approvals. |
| Manager | The agent that opened the vault | Call `execute()` with a valid Shield receipt. Nothing else. |
| Shield signer | Heimdall Shield (AWS KMS key) | Sign receipts. Cannot move funds. |
| Depositor | Anyone | Deposit, withdraw, redeem in kind. |
| Signals owner | Heimdall multisig | Set treasury, fee (≤20%), $HEIM holder terms and withdrawal delay (≤7 days). |

## Security

The contracts were reviewed before launch; every finding is fixed and kept as a regression test, alongside property-based fuzz tests and static analysis. See [heimdall.fund/security](https://heimdall.fund/security).
