# Shield API: load and abuse test

**Date.** 2026-11-24 (UTC). **Target.** The Shield API in production mode (pre-launch, no signer), on one Node process with the in-memory store, against the Robinhood Chain mainnet RPC. The deployed Vercel functions run the same code.

## Load

| Route | Concurrency | Throughput | p99 latency | Errors |
| --- | --- | --- | --- | --- |
| `GET /health` (reads the chain head) | 50 | 10,100 req/s | 20 ms | 0 |
| `GET /v1/risk` (the oracle list) | 100 | 10,100 req/s | 23 ms | 0 |
| `GET /v1/stats` | 50 | 13,000 req/s | 6 ms | 0 |

`/health` does not turn every request into an RPC call: the client caches the block number for a few seconds, so a flood of health checks cannot burn the paid RPC quota. Memory stayed at about 150 MB.

## Abuse

| Test | Result |
| --- | --- |
| Malformed JSON, missing fields, wrong chain, bad address | 400, nothing simulated, nothing charged |
| 2 MB body | 413, connection closed before the body is read |
| Value of 200 digits, above uint256, or negative | 400 (**fixed**: a value above uint256 used to reach the simulator and return 500) |
| Admin routes without a key, with a wrong key, with a 5,000-character key | 403 every time; the key is compared in constant time |
| Free tier at 5 a minute, 40 requests at once from one IP | exactly 5 served, 35 answered 402 with a `PAYMENT-REQUIRED` header (429 when x402 is off) |
| Garbage `PAYMENT-SIGNATURE` headers (not base64, empty JSON, wrong asset) | 402 with the reason, never 500 |
| `/x402/verify` and `/x402/settle` with garbage | 400 |
| Passport link with a malformed address or a 100-digit agent ID | 400 |
| Path traversal in `/v1/risk/:address` | 400 |
| CORS preflight from an unknown origin | no `Access-Control-Allow-Origin` |

## Fixed in this pass

1. **Server-side request forgery through agent registrations.** An ERC-8004 agent's registration URI is chosen by whoever registers the agent, and Shield fetched it with redirects on and no address check. A URI on a private address (or a public name pointed at one) could make Shield call internal services. Now the host must resolve to public addresses only, redirects are refused, and the body is read up to 64 KB as it streams, whether or not a `content-length` is sent.
2. **Webhooks to a name that later points inside.** Webhook URLs were checked when saved, by hostname only. Each delivery now resolves the hostname again and refuses private, loopback, link-local and mapped IPv6 addresses.
3. **Values above uint256** are rejected at the door (see above).
4. **A 1 MB ceiling on every route**, on top of the 128 KB limit the check routes already had.

Regression tests: `test/net.test.ts`.

## Notes

- Rate limits are keyed by the client IP from `x-forwarded-for`. On Vercel that header is set by the platform and cannot be forged; behind any other proxy, make sure the proxy overwrites it.
- With Upstash, counters are atomic across instances, as with the in-memory store tested here.
