---
description: Internal reviews, tests, the independent audit and how to report a vulnerability in Heimdall.
---

# Security

## Reviews

| Review | Scope | Found | Status |
| --- | --- | --- | --- |
| Review 1 | Vaults, Signals, factory, Shield guard | 1 critical, 2 high, 6 medium, 5 low, 6 info | All critical, high and medium fixed |
| Review 2 | Heimdall Pay, staking, fee splitter, stock price feed | 1 medium, 5 low, 7 info | Medium and lows fixed or accepted |
| Review 3 | All contracts: stateful invariant testing, ERC-4626 views, production build size | 2 low | Both fixed |
| Review 4 | Risk Oracle, Guard for Safe (Safe module), x402 facilitator, Agent Passport | 1 medium, 2 low | All fixed |
| Review 5 | Guard for Safe token accounting, vault guardian | 2 medium | Both fixed |
| Review 6 | All contracts before mainnet deployment: swap recipients, staking stream | 1 high, 1 low | Both fixed |
| Addendum | Auto-Invest | 2 low, 3 info | Lows fixed |

Every attack found is kept as a regression test. The contracts have 156 tests, including 15 fuzz properties and 14 stateful invariants, plus fork tests against the real Uniswap router and Chainlink feeds (10,000 fuzz runs and 512 random sequences of 200 actions before each release), and Slither static analysis. An independent audit comes next; its full report will be published when it is done.

## Independent audit

The contracts go to an independent audit firm. The audit pack is ready in the repository (`contracts/audit/`): scope with file hashes, threat model, invariants, known issues and every internal review. The full report will be published, with every finding and how it was fixed.

## How to report

Email **security@heimdall.fund** with the steps or a proof of concept, ideally a test against a fork of Robinhood Chain. We reply within 48 hours.

Test on a local fork only and keep the issue private until it is fixed. If you follow these rules, we will not take legal action over your research.
