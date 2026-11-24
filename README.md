# Heimdall

The guardian layer for onchain agents on Robinhood Chain.

| Path | What | Status |
| --- | --- | --- |
| `apps/shield` | Shield API: transactions + offchain signatures (Permit/Permit2/Seaport), batches, honeypots, blocklist, API keys, limits, KMS signer | 34 tests, live-tested on mainnet RPC |
| `apps/web` | Next.js 16 website + app (Home, Shield console, Signals, Vaults, Agents, Docs, $HEIM, Security, Legal) | builds, verified against a local chain |
| `contracts` | HeimdallVault (ERC-4626, deposit cap) + ShieldGuarded + VaultFactory + VaultDeployer + HeimdallSignals (Hardhat 3) | 21 tests |
| `packages/sdk` | `@heimdallfund/sdk`: Shield client, guardedSend, executeThroughVault, signal vouchers | 4 tests |
| `packages/mcp` | `@heimdallfund/mcp`: MCP server (check_transaction, list_signals, vault_info, list_vaults) | smoke-tested end to end |
| `apps/signals` | Official signals (token risk, address intel, stock premium), x402-style voucher gate, redeemer | 6 tests, live-checked on mainnet |
| `apps/agent` | Reference manager agent ("Guardian Balanced"): signals → plan → Shield receipt → vault.execute | 5 tests + local end-to-end |

## Local end-to-end
```bash
cd contracts && npx hardhat node                                  # terminal 1
cd contracts && npx hardhat run scripts/local-demo.ts --network localhost
cd apps/shield && npm start                                       # :8787
cd apps/web && cp .env.local-demo .env.local && npm run build && npm start
```

Launch goes straight to mainnet (no testnet): vaults start with a 10,000 USDG deposit cap. Before launch: an independent audit of the contracts (four internal reviews are in `contracts/`), a Shield signer key in AWS KMS, and paid RPC.

## License

Business Source License 1.1 (see `LICENSE`). You can read, audit and build on Heimdall: the SDK, MCP server, agent kit and ElizaOS plugin are free to use with Heimdall's own contracts and services. Running a competing service from this code is not allowed until the Change Date (2029-11-24), when the code becomes MIT. Contract interfaces and integration helpers (`IHeimdallRisk`, `IPriceFeed`, `HeimdallRiskAware`, `ShieldGuarded`) are MIT, so any contract can use them.
