# Shield load test

Results from 2026-11-23 on one Node process (2 vCPU sandbox):

| Test | Result |
|---|---|
| Throughput, 50 connections, 20 s, RPC answers cached (`rpc-cache.mjs`) | **~530 req/s**, p50 86 ms, p99 178 ms, 0 errors |
| Throughput, 100 connections, 20 s, before the contract-code cache | ~380 req/s, p50 254 ms, 0 errors |
| Real Robinhood Chain RPC, 25 sequential distinct checks, before | p50 1,263 ms · p95 1,427 ms |
| Real Robinhood Chain RPC, 25 sequential distinct checks, after | **p50 46 ms · p95 54 ms** (first call 1.4 s, cold cache) |

What changed:

1. **Spender lookups run in parallel with the simulation.** Spenders that are known from the calldata are fetched at the same time, which saves one RPC round trip.
2. **Known contracts are cached for 1 hour**, per RPC client, up to 5,000 entries. Wallets and EIP-7702-delegated accounts are never cached.

On the public RPC, fetching a large contract's code took about 1.2 s from the test machine; the cache takes it off the hot path. One process is CPU-bound by EIP-712 receipt signing at about 500 req/s. Scale horizontally behind the load balancer; the store (Upstash) is shared.

Run:

```bash
node loadtest/rpc-cache.mjs &                                   # caching RPC proxy on :8599
RPC_URL_MAINNET=http://127.0.0.1:8599 SHIELD_FREE_RPM=1000000 SHIELD_FREE_DAILY=100000000 \
  SHIELD_SIGNER_KEY=0x… npx tsx src/server.ts &
npx autocannon -c 50 -d 20 -m POST -H content-type=application/json -b "$(cat loadtest/body.json)" http://127.0.0.1:8787/v1/check
node loadtest/latency.mjs                                        # real-RPC latency (start Shield without the proxy)
```
