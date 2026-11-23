---
description: Guardian Points reward people who make Robinhood Chain safer.
---

# Guardian Points

Guardian Points, season 1, reward actions that reduce risk on Robinhood Chain. Every point comes from something checkable onchain or reviewed by a person.

| Action | Points | How it is checked |
| --- | --- | --- |
| Revoke a risky approval | 50 each, up to 5 a day and 25 a season | The revoke transaction's receipt, and only for approvals Wallet Check flagged |
| Report a drainer | 200 | A reviewer confirms it; the address joins the blocklist |
| Hold USDG in Heimdall vaults | 1 per 100 USDG per day | A daily onchain snapshot of vault share holders |
| Use Shield with your API key | 1 per 100 checks | Counted by the Shield API, up to 50 points a day |
| Join early access | 100, once | Before launch; the wallet needs at least one transaction on Robinhood Chain |
| First stake | 25, once | A stake of at least 1,000 HEIM, read from the transaction |
| First Pay job | 25, once | A funded job of at least 10 USDG to someone else, read from the transaction |
| Invite a friend | 100 each, up to 25 a season | Paid only when the invited wallet does something real (see below) |

## Invites

Every wallet that joins early access gets an invite link, `heimdall.fund/r/<code>`. A wallet that opens it and then joins is linked to the inviter. Nothing is paid for the sign-up itself: the inviter earns 100 points when the new wallet makes a vault deposit, has a drainer report confirmed, or makes its first stake or Pay job. The new wallet gets 25 points at the same moment. A wallet cannot invite itself, and only wallets new to Heimdall can be invited.

Points are an offchain record. They are not a token, cannot be transferred, and carry no promise of value.

## API

```bash
curl https://api.heimdall.fund/v1/points/leaderboard
curl https://api.heimdall.fund/v1/points/0xYourWallet
```
