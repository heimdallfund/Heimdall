---
description: See every live approval of a wallet, ranked by risk, and revoke the dangerous ones.
---

# Wallet Check

Wallet Check finds every live token approval of a Robinhood Chain wallet. It ranks each one by risk, shows how many dollars it exposes, and lets the owner revoke it. Checking is read-only and works for any address; only revoking sends a transaction.

## What it reads

* ERC-20 approvals (`approve`, `permit`)
* Permit2 allowances (expired ones are ignored)
* Operator approvals (`setApprovalForAll`)

Each one is re-read live from the chain, so revoked approvals never show up.

## Risk levels

| Level | When |
| --- | --- |
| Danger | The spender is a plain wallet, is on the Heimdall blocklist, or Shield has been denying transactions to it |
| Review | An unlimited approval or operator approval to a contract Heimdall does not recognise |
| OK | A known protocol contract (Uniswap routers, Permit2) or a limited allowance |

**Value at risk** is the smaller of the allowance and the wallet's balance, priced with Chainlink feeds (USDG at $1).

## Suspicious tokens

Wallet Check also looks at the tokens the wallet holds, because the token itself can be the trap. Each one is checked against the blocklist and for a stolen ticker (a fake NVDA or USDG), and up to five unknown tokens get a full [Token Check](https://heimdall.fund/token-check): a token that cannot be sold, can vanish from the wallet, or can be pulled out by its owner is flagged. They are listed in `tokens`, each with a `code` (`FAKE_TOKEN`, `BLOCKLISTED_TOKEN`, `HONEYPOT`, `VANISHING_TOKEN`, `ALLOWANCE_BYPASS`, …). Do not swap, approve or send a flagged token.

## API

```bash
curl https://api.heimdall.fund/v1/wallet/0xYourWallet
```

Large histories are read in steps. While `complete` is `false`, call again (add `?refresh=1`) and `progress` climbs to 100.

## Wallet Watch

Turn on **Watch this wallet** on a report and the browser shows a notification when a new risky approval appears (Danger or Review), including one to a spender that joins the blocklist later. Heimdall re-checks watched wallets every 15 minutes; the first check only records what is already there. Developers can get the same alerts on their server: see [Webhooks](../shield/webhooks.md).

- Up to 5 wallets per browser. **Stop watching** removes the subscription.
- It uses standard web push: no account, no email. Heimdall stores the browser's push address and the wallet addresses, nothing else.
- It does not see outgoing transfers or signatures, only approvals.

## Revoking

| Approval | Transaction |
| --- | --- |
| ERC-20 | `approve(spender, 0)` on the token |
| Operator | `setApprovalForAll(operator, false)` on the collection |
| Permit2 | `lockdown([(token, spender)])` on Permit2 |

Each risky approval you revoke earns 50 [Guardian Points](points.md), up to 5 a day and 25 a season.

## Token Check

[Token Check](https://heimdall.fund/token-check) (`GET /v1/token/{address}`) tests one token by trading it in a simulation of the current block with a throwaway wallet:

- **Where it trades.** Memecoins still on a **Pons** bonding curve are bought and sold on the curve itself, also when the curve is priced in another token. Tokens that trade in a Uniswap v3 or v4 pool (after graduating, or from launch on Klik, DYOR.fun, Bow.fun, RealFun, Noxa and others) are tested in that pool. hood.fun, Printr and RobinFun tokens are recognised; their old curves are reported, not simulated.
- **Traps.** Honeypot (sell reverts), buy, sell and transfer taxes, tokens that vanish, clawback without approval, fake tickers, the blocklist, and Uniswap v4 hooks that can change swap amounts.
- **Dev and holders**, read from the token's transfers and current balances: the launchpad and dev wallet, how far the curve is from graduating, the dev's share and how much of it they sold (burns excluded), the top holders (pools, curves and burn addresses excluded), wallets that bought in the first blocks, and the dev's other Pons launches in about the last month.
- **In plain words.** `GET /v1/token/{address}/summary` returns a short explanation written by an AI model from the check's results only. The verdict is always the simulation's.
