---
description: >-
  POST /v1/check: simulate a Robinhood Chain transaction and get ALLOW, WARN or
  DENY with reasons and a signed receipt.
---

# Transaction checks

Send the transaction your agent is about to sign. Shield runs it against the latest block with `eth_simulateV1` and tells you exactly what would happen.

## Request

```http
POST https://api.heimdall.fund/v1/check
Authorization: Bearer hd_live_…        (optional on the free plan)
Content-Type: application/json

{
  "chainId": 4663,
  "from": "0xAgentWallet",
  "to": "0xTargetContract",            // null to deploy a contract
  "data": "0x…",
  "value": "0",                         // wei, decimal or 0x-hex
  "policy": { … }                       // optional, see below
}
```

## Response

```json
{
  "checkId": "0x51705c…",
  "verdict": "DENY",
  "riskScore": 90,
  "summary": ["Calls approve(address,uint256) on USDG (0x5fc5…d168)", "Approves unlimited USDG → 0x3333…3333"],
  "findings": [{ "code": "UNLIMITED_APPROVAL_TO_EOA", "severity": "deny", "message": "…" }],
  "approvals": [ … ],
  "assetChanges": [{ "symbol": "USDG", "delta": "-100000000", "kind": "erc20", … }],
  "simulation": { "ok": true, "available": true, "gasUsed": "46213" },
  "receipt": { "signer": "0x…", "signature": "0x…", "expiresAt": 1795400000, "message": { … } }
}
```

`verdict` is `ALLOW`, `WARN` or `DENY`; `riskScore` runs 0–100. A WARN stays a WARN unless the policy sets `strict`; then every WARN becomes DENY. Vaults only accept receipts whose verdict is ALLOW.

## Policy

| Field | Effect |
| --- | --- |
| `strict` | Every WARN becomes DENY. |
| `allowTargets` | If set, the target must be in this list. |
| `denyTargets` | Targets that are always denied. |
| `maxNativeOut` | Per-transaction cap for ETH leaving the wallet, in wei. |
| `maxTokenOut` | Per-transaction cap per token, raw units, keyed by token address. |
| `trustedSpenders` | Unlimited approvals to these spenders do not warn. |
| `denyUnlimitedApprovals` | Unlimited approvals are always denied. |
| `trustedRecipients` | Sending assets to these does not raise `ONE_WAY_OUTFLOW`. |
| `trustedDelegates` | EIP-7702 delegate contracts the agent may authorise beyond the wallet implementations Heimdall knows. |
| `allowContractDeploy` | Allow `to = null`. |

## Findings

| Code | Severity | Meaning |
| --- | --- | --- |
| `SIM_REVERTED` | deny | The transaction would revert; the reason is decoded. |
| `UNLIMITED_APPROVAL_TO_EOA` / `APPROVAL_TO_EOA` | deny / warn | Approval (ERC-20, Permit2, setApprovalForAll) to an address with no code. |
| `UNLIMITED_APPROVAL` | warn | Unlimited approval to an untrusted contract, also inside multicall and Universal Router batches. |
| `HONEYPOT` | deny | A token you receive cannot be transferred again, or cannot be sold back to the pool it came from. |
| `VANISHING_TOKEN` | deny / warn | A token arrives and is taken out of the wallet in the same transaction (denied when you paid for it). |
| `ALLOWANCE_BYPASS` | deny | A stranger, or the token's `owner()`, can `transferFrom` your wallet with no allowance: tokens can be clawed back. |
| `FAKE_TOKEN` | deny / warn | The symbol (deny) or name (warn) of a known token such as USDG, WETH or a stock token, at a different address. Look-alike letters and zero-width characters are folded first. |
| `HOOK_TAKES_DELTA` | warn | A Uniswap v4 pool on the route has a hook that can change swap amounts: a hidden fee of any size. |
| `HOOK_DYNAMIC_FEE` | warn | A Uniswap v4 pool whose hook sets the swap fee at swap time. |
| `HOOK_ON_SWAP` | info | A v4 hook runs on every swap and could refuse later trades. |
| `HOOK_NO_CODE` / `BLOCKLISTED_HOOK` | deny | The pool names a hook with no contract, or a known malicious one. |
| `LOOKALIKE_ADDRESS` | deny | A target, recipient or spender that shares 3+ first and last characters (8+ in total) with a known address, a trusted one in your policy, or one this wallet already used: address poisoning. |
| `TRANSFER_TAX` | info / warn / deny | A received token loses value on transfer (≥5% warns, ≥50% denies). |
| `NATIVE_LIMIT` / `TOKEN_LIMIT` | deny | Above a policy cap. |
| `DRAINS_BALANCE` | warn | Moves 90% or more of the wallet's balance of an asset. |
| `ONE_WAY_OUTFLOW` | warn | Assets leave to an untrusted address and nothing comes back. |
| `BLOCKLISTED_TARGET` / `SPENDER` / `RECIPIENT` / `TOKEN` | deny | A known drainer or exploit address is involved, or the token being bought is a known scam. |
| `ZERO_TARGET` | deny | Sending to the zero address. |
| `TARGET_NOT_ALLOWED` / `DENYLISTED_TARGET` | deny | Outside the policy's allow list, or on its deny list. |
| `EOA_WITH_DATA` | warn | Calldata sent to an address with no code. |
| `SIM_UNAVAILABLE` | warn | The simulator could not run; nothing is assumed safe. |
| `DELEGATED_EOA`, `KNOWN_CONTRACT`, `APPROVAL_REVOKE` | info | Context only. |

## Receipts

Each verdict is signed as EIP-712 with domain `{ name: "Heimdall Shield", version: "1", chainId }` and type:

```
Receipt(address agent, address target, bytes32 dataHash, uint256 value, uint8 verdict, uint64 expiresAt, bytes32 checkId)
```

`GET /v1/signer` returns the current signer address. Heimdall vaults accept a receipt once, only before it expires, and only for exactly the same call.
