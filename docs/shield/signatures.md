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

// EIP-7702 authorization: the contract the wallet would delegate to
{ "chainId": 4663, "signer": "0xAgent", "authorization": { "chainId": 4663, "address": "0xDelegate", "nonce": 7 } }
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
| EIP-7702 authorization | Allowed only for known wallet implementations (MetaMask DeleGator, Simple7702Account, Uniswap Calibur, Coinbase EIP7702Proxy, Ambire) or ones in `trustedDelegates`. Denied for chain ID 0, another chain, an address with no code, a blocklisted contract or any unknown contract. The same rules apply to the `authorizationList` of a type 4 transaction sent to `/v1/check`. |
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
| `UNKNOWN_DELEGATE` | deny | EIP-7702: hands full control of the wallet to a contract Heimdall does not know. |
| `AUTH_ALL_CHAINS` | deny | EIP-7702 authorization with chain ID 0: valid on every chain. |
| `DELEGATE_NO_CODE` / `DELEGATE_IS_WALLET` / `BLOCKLISTED_DELEGATE` | deny | EIP-7702 delegate with no code yet, a delegated wallet, or a known malicious contract. |
| `KNOWN_DELEGATE` / `TRUSTED_DELEGATE` / `AUTH_REVOKE` | info | A known wallet implementation, one your policy trusts, or clearing the delegation. |

{% hint style="info" %}
The same policy fields as [transaction checks](transactions.md#policy) apply, for example `trustedSpenders` for your own router.
{% endhint %}
