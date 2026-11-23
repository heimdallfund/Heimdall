---
description: >-
  POST /v1/check-signature: judge Permit, Permit2, Seaport and personal_sign
  requests before an agent signs them.
---

# Signature checks

Most drains today never start with a transaction: the victim signs a Permit or Permit2 message and the attacker submits it later. Check every signature request first.

## Request

```http
POST https://api.heimdall.fund/v1/check-signature

// EIP-712 (eth_signTypedData_v4) — pass the payload exactly as the app gave it
{ "chainId": 4663, "signer": "0xAgent", "typedData": { "domain": {…}, "types": {…}, "primaryType": "PermitSingle", "message": {…} } }

// personal_sign / eth_sign
{ "chainId": 4663, "signer": "0xAgent", "message": "0x…" }
```

## What is recognised

| Type | Checks |
| --- | --- |
| EIP-2612 Permit | Spender is a contract, amount, deadline, owner = signer. |
| DAI-style Permit | Spender and expiry (DAI permits are always unlimited). |
| Permit2 PermitSingle / PermitBatch | Every token, amount and expiration; spender. |
| Permit2 PermitTransferFrom (+ batch, witness) | Tokens, amounts, spender, deadline. |
| Seaport OrderComponents | Denies orders that give assets away for nothing; warns on any listing. |
| personal\_sign of a 32-byte hash | Denied: blind signing can authorise anything. |
| Anything else | WARN: unrecognised typed data. |

## Findings

| Code | Severity | Meaning |
| --- | --- | --- |
| `PERMIT_TO_EOA` / `PERMIT_UNLIMITED_TO_EOA` | deny | A plain wallet could take your tokens. |
| `PERMIT_UNLIMITED` | warn (deny with policy) | Unlimited permit to an untrusted contract. |
| `PERMIT_LONG_EXPIRY` | warn | Valid for more than 30 days. |
| `WRONG_CHAIN` | deny | The signature is for another chain. |
| `ORDER_FOR_NOTHING` | deny | Marketplace order that pays you nothing. |
| `BLIND_HASH_SIGNATURE` | deny | Signing an opaque 32-byte hash. |
| `BLOCKLISTED_SPENDER` / `BLOCKLISTED_CONTRACT` | deny | Known malicious address. |

{% hint style="info" %}
The same policy fields as [transaction checks](transactions.md#policy) apply, for example `trustedSpenders` for your own router.
{% endhint %}
