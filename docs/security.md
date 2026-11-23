---
description: Internal reviews, tests and how to report a vulnerability in Heimdall.
---

# Security and bug bounty

## Reviews

| Review | Scope | Found | Status |
| --- | --- | --- | --- |
| Review 1 | Vaults, Signals, factory, Shield guard | 1 critical, 2 high, 6 medium, 5 low, 6 info | All critical, high and medium fixed |
| Review 2 | Heimdall Pay, staking, fee splitter, stock price feed | 1 medium, 5 low, 7 info | Medium and lows fixed or accepted |
| Review 3 | All contracts: stateful invariant testing, ERC-4626 views, production build size | 2 low | Both fixed |
| Addendum | Auto-Invest | 2 low, 3 info | Lows fixed |

Every attack found is kept as a regression test. The contracts have 112 tests, including 13 fuzz properties and 12 stateful invariants (10,000 fuzz runs and 512 random sequences of 200 actions before each release), and Slither static analysis. An external audit has not been done yet; its report will be published when it is.

## Bug bounty

Rewards are paid in USDG on Robinhood Chain once the fix is live. Critical and High pay 10% of the funds at risk, up to the cap.

| Severity | Reward | Examples |
| --- | --- | --- |
| Critical | Up to 10,000 USDG | Theft or permanent freezing of depositor funds, escrow, staked $HEIM or user USDG approved to a Heimdall contract |
| High | Up to 3,000 USDG | Temporary freezing of funds, theft of unclaimed fees or rewards, a manager losing more than the loss caps, a buy filled outside the user's bound |
| Medium | 1,000 USDG | A contract fails to deliver what it promises without losing funds |
| Low | 200 USDG | Shield API or web app issues that could mislead a user into signing something harmful |

**In scope:** the Heimdall contracts on Robinhood Chain, the Shield API (an ALLOW for something that drains the signer), receipt signing, and heimdall.fund where it could lead a user to sign something harmful.

**Out of scope:** issues already in the reviews, including accepted risks; USDG, Chainlink, Uniswap, the stock tokens and Robinhood Chain itself; attacks that need the multisig, a leaked key or a phished user; rate limits, spam and volume-based denial of service.

## How to report

Email **security@heimdall.fund** with the steps or a proof of concept, ideally a test against a fork of Robinhood Chain. We reply within 48 hours and agree on the severity within 5 days.

Test on a local fork only, keep the issue private until it is fixed, and one reward is paid per root cause, to the first report. If you follow these rules, we will not take legal action over your research.
