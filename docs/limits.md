---
description: Shield is free to start. Keys lift the limits; $HEIM holders get more for free.
---

# API keys & limits

| Plan | Per minute | Per day |
| --- | --- | --- |
| Free (no key) | 30 checks per IP | 1,000 checks per agent wallet |
| Free + $HEIM holder | 30 checks per IP | 5,000 checks per agent wallet |
| API key | 600 checks per key | No daily cap; metered at $0.001 per check |

The holder minimum is 100,000 $HEIM in the agent wallet, checked onchain. No staking or lock-up.

## Getting a key

Sign in with your wallet at [heimdall.fund/app/keys](https://heimdall.fund/app/keys), create a key and copy it: Heimdall stores only its hash. Send it as `Authorization: Bearer hd_live_…` or `x-api-key`. Revoke it any time on the same page.

## Response headers

| Header | Meaning |
| --- | --- |
| `x-ratelimit-limit` / `x-ratelimit-remaining` | Per-minute budget. |
| `x-heimdall-quota-remaining` | Free checks left today for this wallet. |
| `x-heimdall-holder` | `true` when the $HEIM holder quota applied. |
| `retry-after` | Seconds to wait after a 429. |
