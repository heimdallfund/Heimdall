---
description: Signed HTTPS events when Shield blocks one of your agents or a wallet you run gains a risky approval.
---

# Webhooks

Heimdall can POST to your server the moment Shield blocks one of your agents, or when a wallet you run picks up a risky approval. Every event is signed.

## Set up

1. Open [API keys & webhook](https://heimdall.fund/app/keys) and sign in with the wallet that owns your API keys.
2. Enter an HTTPS endpoint, pick the events, and list up to 20 wallets to watch (usually your agents' wallets).
3. Copy the signing secret (`whsec_…`). It is shown once; **New secret** replaces it.
4. Press **Send test event**. The last 20 deliveries are listed with their HTTP status.

## Events

| Type | When |
| --- | --- |
| `shield.deny` | A transaction or signature check made with one of your API keys returned DENY |
| `shield.warn` | The same, for WARN |
| `wallet.risky_approval` | A watched wallet gained a new Danger or Review approval (checked every 15 minutes) |
| `token.rugged` | A token Heimdall checked while it still traded had its liquidity pulled or can no longer be sold (any token; re-checked for three days) |
| `test` | Sent by the Send test event button |

## Payload

A JSON body with `id`, `type`, `createdAt` (UTC) and `data`. Headers: `heimdall-event`, `heimdall-delivery` and `heimdall-signature`.

```json
{
  "id": "evt_Qm3x…",
  "type": "shield.deny",
  "createdAt": "2026-11-23T14:02:11.402Z",
  "data": {
    "kind": "tx",
    "checkId": "0x9f…",
    "verdict": "DENY",
    "riskScore": 95,
    "findings": [{ "code": "BLOCKLISTED_TARGET", "severity": "deny", "message": "…" }],
    "chainId": 4663,
    "from": "0xYourAgent…",
    "to": "0xDrainer…",
    "apiKeyId": "a1b2c3d4e5f6"
  }
}
```

## Verify the signature

`heimdall-signature` is `t=<unix seconds>,v1=<hex>`, where the hex is HMAC-SHA256 of `<t>.<raw body>` with your secret. Check it against the raw body before parsing, and reject events older than five minutes:

```typescript
import { parseWebhook } from "@heimdallfund/sdk";

const event = await parseWebhook({ secret: process.env.HEIMDALL_WEBHOOK_SECRET!, body: rawBody, signature: req.headers.get("heimdall-signature") });
```

## Delivery rules

* Answer with any 2xx within 5 seconds. Redirects are not followed.
* Events are sent once and not retried; use `id` to drop duplicates.
* After 15 failed deliveries in a row the webhook is switched off. Saving it again switches it back on.
* Endpoints must be public HTTPS: localhost, private networks and credentials in the URL are refused.
