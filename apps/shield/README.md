# Heimdall Shield

Transaction firewall for AI agents on Robinhood Chain. An agent sends the transaction it is about to sign; Shield simulates it against live chain state and answers **ALLOW / WARN / DENY** with reasons, plus an EIP-712 signed receipt that Heimdall Vault can verify onchain.

## What it checks
- **Simulation** (`eth_simulateV1` + `traceTransfers`): reverts, exact asset changes for the agent wallet
- **Approvals**: unlimited ERC-20 / Permit2 / `setApprovalForAll`, approvals to plain wallets (drainer pattern)
- **Targets**: zero address, non-contract with calldata, EIP-7702 delegated accounts, allow/deny lists
- **Spend limits**: per-tx native and per-token caps, ≥90% balance drains, one-way outflows

## API
`POST /v1/check`
```json
{
  "chainId": 4663,
  "from": "0xAgent…",
  "to": "0xTarget…",
  "data": "0x…",
  "value": "0",
  "policy": {
    "strict": false,
    "allowTargets": ["0x…"],
    "denyTargets": [],
    "maxNativeOut": "100000000000000000",
    "maxTokenOut": { "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168": "1000000000" },
    "trustedSpenders": [],
    "denyUnlimitedApprovals": false,
    "trustedRecipients": []
  }
}
```
Returns `verdict`, `riskScore`, `summary`, `findings`, `approvals`, `assetChanges`, `simulation`, `receipt`.

`GET /v1/signer`: receipt signer address and the EIP-712 domain/types.
`GET /health`

## Production setup

| Piece | How |
| --- | --- |
| Receipt signer | `SHIELD_KMS_KEY_ID`: AWS KMS key, spec `ECC_SECG_P256K1`, usage `SIGN_VERIFY`. The key never leaves KMS; signatures are normalised to low-s. The server refuses to start in production without a signer. After deploy, read the address from `GET /v1/signer` and set it as the Shield signer on the vault factory. |
| API keys | `npx tsx scripts/new-api-key.ts <name>` → give the key to the customer once, put `name:sha256` in `SHIELD_API_KEYS`. Keys are compared by hash in constant time. |
| Limits | Free (no key): `SHIELD_FREE_RPM` per IP per minute, `SHIELD_FREE_DAILY` checks per agent wallet per day. Pro (key): `SHIELD_PRO_RPM` per minute, usage metered per day for billing. `SHIELD_REQUIRE_KEY=true` closes the free tier. |
| Counters | Upstash Redis via REST (`UPSTASH_REDIS_REST_URL`/`TOKEN`, or `KV_REST_API_URL`/`TOKEN` from the Vercel integration), needed when running more than one instance. |
| RPC | `RPC_URL_MAINNET` (paid, e.g. Alchemy) with the public endpoint as automatic fallback. |
| Hosting | Vercel (`src/index.ts` exports the app) or Docker (`Dockerfile`). The per-IP limit trusts `x-forwarded-for`, which Vercel and most load balancers set; do not expose the container directly. |

## Run
```bash
npm install
npm test           # unit tests (mocked chain)
npx tsx scripts/live.ts   # live checks against Robinhood Chain mainnet
npm start          # API on :8787
```

All settings: `.env.example`.

Chains: Robinhood Chain mainnet (4663) and testnet (46630).
