---
description: Stake $HEIM and earn a share of protocol fees in USDG.
---

# Staking $HEIM

Stakers earn a share of the USDG fees Heimdall collects. There are no emissions: rewards come only from fees people paid.

## How fees reach stakers

1. Signals fees and the vault platform fee go to **HeimdallFeeSplitter**.
2. Once a day, anyone (the monitor does it) calls `distribute(USDG)`. The stakers' share (50% at launch, capped at 80% by the contract) goes to **HeimdallStaking**. The rest goes to the treasury.
3. Each payout streams to stakers over 7 days, pro rata to their stake. Claim at any time.

Streaming means a stake made right before a payout and pulled right after earns almost nothing. Rewards that arrive while nobody stakes are kept for the next stakers.

## Contract

| Function | What it does |
| --- | --- |
| `stake(amount)` | Stake $HEIM |
| `withdraw(amount)` | Unstake; no lock-up |
| `claim()` | Collect earned USDG |
| `exit()` | Withdraw everything and claim |
| `earned(user)` | USDG claimable now |
| `rewardPerDay()` | USDG streamed to all stakers per day right now |

HeimdallStaking has no owner and no admin functions. The splitter's share and treasury can only be changed by the 2-of-3 Safe.

## Staking keeps your holder benefits

Staked $HEIM still counts as held. Every holder check (the bigger Shield quota, the lower vault and Signals fees, the Guardian badge) reads `HeimdallHolderBalance`, which adds the $HEIM in your wallet to the $HEIM you have staked.
