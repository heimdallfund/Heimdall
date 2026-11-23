# Heimdall operations runbook

All times UTC. All admin power lives in the **Safe** (`adminSafe`). The deployer key only deploys and hands over ownership; after launch it holds nothing.

## Roles

| Role | Holder | Powers |
|---|---|---|
| Safe (multisig) | Heimdall signers | Owns the factory, Signals and every vault. Pause, caps, allowed calls, feeds, Shield signer, manager rotation, fees. |
| Deployer | Hot key, used once | Deploys, configures, starts the ownership transfer. Nothing after the Safe accepts. |
| Shield signer | AWS KMS key | Signs receipts. Cannot move funds. Rotated by the Safe. |
| Treasury | Address in config | Receives platform fees (vault 5%, Signals 10%). |
| Manager | Agent wallet per vault | `execute()` with a valid receipt. Nothing else. |
| Risk reporter | Monitor key (`RISK_REPORTER_KEY`), a little ETH for gas | Writes Shield's risk list to `HeimdallRiskOracle` (max 200 entries per call). Cannot touch pinned entries. Replaced by the Safe with `setReporter`. |
| Passport publisher | Monitor key (`PASSPORT_KEY`), a little ETH for gas | Publishes the daily Heimdall Score of linked agents to the ERC-8004 Reputation Registry. Must not own any agent identity (no self-feedback). Holds no funds. |
| x402 facilitator | Shield key (`X402_FACILITATOR_KEY`), a little ETH for gas | Submits agents' signed USDG payments (`transferWithAuthorization`). Can only settle what the payer signed, to the recipient they signed. Holds no USDG. |
| Guard module owner | The Safe | Only sets the default Shield signer of `HeimdallGuardModule`. Each user's Safe controls its own agents, limits and pause. |

## Before deploy

1. **Safe:** deploy the Safe on Robinhood Chain (app.safe.global) with the chosen signers and threshold.
2. **Shield signer:** create the KMS key and read its address (`GET /v1/signer` on a staging Shield API).
3. **Config:** copy `deploy/robinhood.config.example.json` to `deploy/robinhood.config.json` and fill every `<SET>`:
   - Price feed per stock token, with a heartbeat that matches the feed's update cadence.
   - Only reviewed `(router, function)` pairs in `calls`. Never `multicall` and never a token address.
4. **Rehearse on a mainnet fork:**
   ```bash
   npm run test:fork      # real USDG, NVDA, Uniswap SwapRouter02
   npm run deploy:dry     # full deploy + configure + handover on a fork
   ```
5. **Fund the deployer** with a little ETH for gas.

## Deploy

```bash
DEPLOYER_KEY=0x… DEPLOY_CONFIG=deploy/robinhood.config.json npm run deploy
```

The script:
1. Checks the chain ID (4663) and that the Safe, USDG and routers have code.
2. Checks that every price feed is fresh.
3. Deploys `HeimdallVaultDeployer`, `HeimdallVaultFactory` and `HeimdallSignals`.
4. Configures defaults, caps and $HEIM terms.
5. Starts a two-step ownership transfer to the Safe.
6. Writes these files:
   - `deployments/robinhood.json`
   - `deployments/robinhood.safe-accept-ownership.json`

## After deploy

1. In the Safe, open **Transaction Builder**, import `robinhood.safe-accept-ownership.json`, review it, sign and execute. Both contracts are now owned by the Safe.
2. Verify the source on Blockscout:
   ```bash
   npx hardhat verify --network robinhood <address> <constructor args…>
   ```
3. Set the web env vars and redeploy the web:
   - `NEXT_PUBLIC_FACTORY_ADDRESS`
   - `NEXT_PUBLIC_SIGNALS_ADDRESS`
   - `NEXT_PUBLIC_RISK_ORACLE_ADDRESS`
   - `NEXT_PUBLIC_GUARD_MODULE_ADDRESS`
4. Integrations: Shield `RISK_ORACLE_ADDRESS`, `PASSPORT_PUBLISHER_ADDRESS`, `SHIELD_PUBLIC_URL`, `X402_PAY_TO` (treasury) and `X402_FACILITATOR_KEY` (fund with a little ETH; x402 turns on when both are set); monitor `RISK_ORACLE`, `RISK_REPORTER_KEY`, `PASSPORT_KEY` (fund both with a little ETH). If `riskReporter` was not set in the deploy config, call `setReporter(<reporter>, true)` from the Safe. Check the first sync on the monitor log and `GET /v1/risk/<address>`.
5. Point Shield, Signals and the monitor at the same addresses.
6. Run the reference agent with `npm run dry-run`, then with one small real cycle.
7. Post the addresses publicly and update `docs/build/contracts.md`.

## $HEIM launch day

The day before, run `scripts/rehearsal.sh`: it plays this whole section, plus a Pay job, an Auto-Invest buy and a fee distribution, on a local copy of mainnet, and must end with every check passing.

Do this only after every contract above is live and owned by the Safe. Do not let anyone open a vault between the token launch and step 3: a vault reads the $HEIM terms once, when it is created.

1. Launch $HEIM (Pons). Note the token address.
2. Deploy staking and the fee splitter, and build the Safe batch:
   ```bash
   HEIM=<token> STAKER_BPS=5000 npx hardhat run scripts/deploy-staking.ts --network robinhood
   ```
3. In the Safe, import `deployments/robinhood.safe-route-fees.json`. One batch accepts the splitter, routes every fee (Signals, factory, vaults, Pay, Auto-Invest) to it, and sets the $HEIM holder terms on the factory and Signals (100,000 $HEIM, Signals holder fee 5%). Sign and execute.
4. Env, then redeploy: web `NEXT_PUBLIC_HEIM_ADDRESS`, `NEXT_PUBLIC_HEIM_HOLDER_ADDRESS`, `NEXT_PUBLIC_STAKING_ADDRESS`, `NEXT_PUBLIC_SPLITTER_ADDRESS`; Shield `HEIM_HOLDER_ADDRESS`, `HEIMDALL_STAKING_ADDRESS`; monitor `SPLITTER`. Holder status everywhere reads `HeimdallHolderBalance`: $HEIM held plus staked.
5. Check: `/api/heim/supply` answers, `/stake` shows the pool, and a holder wallet gets `x-heimdall-holder: true` from Shield.

## Routine changes

Generate a Safe batch, review it, then sign it in the Safe. Nothing is sent by the script.

```bash
OP=deposit-cap CAP=25000000000 npx hardhat run scripts/ops.ts --network robinhood   # raise caps to 25,000 USDG
OP=set-feed TOKEN=0x… FEED=0x… HEARTBEAT=86400 npx hardhat run scripts/ops.ts --network robinhood
```

New vaults pick up factory defaults. Existing vaults need per-vault calls, which `ops.ts` generates for all vaults by default.

## Emergency playbook

| Situation | Immediate action (Safe) | Command |
|---|---|---|
| Suspected exploit or unknown behaviour | Pause all vaults. Withdrawals and in-kind exits keep working. | `OP=pause` |
| Shield signer key exposed | Add the new KMS signer, remove the old one, then rotate the API's key | `OP=signer NEW_SIGNER=… OLD_SIGNER=…` |
| Router compromised | Disable its calls, revoke allowances, then pause if funds moved | `OP=disable-call TARGET=… SIGNATURE=…` then `OP=revoke TOKEN=… SPENDER=…` |
| Price feed stale or retired | Point the asset at a replacement feed | `OP=set-feed TOKEN=… FEED=… HEARTBEAT=…` |
| Manager misbehaving | Pause the vault, then `setManager` to a new agent | `OP=pause VAULTS=0x…` |
| Risk reporter key exposed or writing wrong entries | Remove it, add a new one, pin any address that must not change | `setReporter(old, false)`, `setReporter(new, true)`, `pin(…)` |
| Shield signer exposed (Guard module) | `setShieldSigner` on the module; Safes that use their own signer are not affected | Safe Transaction Builder |
| x402 facilitator key exposed | Clear `X402_FACILITATOR_KEY` (x402 turns off, free tier keeps working), then set a new key. It never holds USDG, only gas | Shield env |
| Vault growing faster than its record | Lower its deposit cap | `OP=deposit-cap CAP=… VAULTS=0x…` |

After any emergency action:
1. Post a short status on X (what happened, what is paused, that exits work).
2. Write a postmortem within 72 hours.

## Hosting

- Web: Vercel project `heimdall-web` (root `apps/web`), deployed on every push to `main` of `heimdallfund/Heimdall`.
- Shield API: a second Vercel project (root `apps/shield`) once the KMS signer, Upstash and RPC keys exist; it refuses to start in production without a signer.
- Monitor and keeper: one always-on container (`apps/monitor`).

## Docs on GitBook

The Markdown in `docs/` is the source of the docs; `.gitbook.yaml` points GitBook at it (`README.md` home, `SUMMARY.md` table of contents).

1. In GitBook, create a space, then **Configure → GitHub Sync**, install the GitBook app on the `heimdallfund` org with access to `Heimdall` only, branch `main`, direction **GitHub → GitBook**. The private repo stays private.
2. Customize → domain `docs.heimdall.fund`, then add the CNAME GitBook shows to the DNS of `heimdall.fund`.
3. Set `NEXT_PUBLIC_DOCS_URL=https://docs.heimdall.fund` on the web and redeploy: every `/docs/*` page redirects to the same page on GitBook (map in `apps/web/next.config.ts`), and unknown docs paths go to the GitBook home.
4. Edit docs in `docs/` only. When a page is added, add it to `docs/SUMMARY.md` and to `DOCS_MAP`.

## Admin panel

`https://heimdall.fund/admin` (not indexed) opens with the monitor's admin key, kept only in that browser tab. It shows:
- drainer reports waiting for review (Confirm adds the address to the blocklist and pays the reporter 200 points; Reject closes it), with the recent decisions,
- the community blocklist, with Remove for a wrong report,
- Agent Arena seasons, editable and saved to the Shield store (they override `ARENA_SEASONS`),
- keeper and fee numbers read onchain: Auto-Invest buys due, fees waiting, splitter balance, staked $HEIM, Pay payouts owed,
- anonymous analytics: daily event counts and top pages (no cookies, no IPs, no wallet addresses),
- incidents for the public status page: post one when users are affected, add updates, and close it with `resolved`.

## Status page

`https://heimdall.fund/status` shows Shield, the Robinhood Chain RPC, the vault monitor and the keeper, 30 days of uptime and every incident (times in UTC).
- The monitor posts a heartbeat every tick (`POST /v1/admin/heartbeat`) with its own probes of Shield `/health` and the RPC's latest block; the keeper posts one after each run.
- The monitor shows `degraded` after 15 minutes without a heartbeat and `down` after 60; the keeper after 30 and 180 minutes.
- Any open incident turns the page's banner to "Part of Heimdall is down". Write incidents in plain English for users: what is affected, what is not, what you are doing.

## Early access and invites

- `/early` is open until `EARLY_ACCESS_UNTIL` (ISO time, UTC) on Shield; unset keeps it open. A wallet needs at least one transaction on Robinhood Chain; each gets 100 points once, and one network address can sign up 3 wallets a day.
- Invite links are `/r/<code>`. The inviter earns 100 points (25 a season at most) only when the invited wallet does something real: a confirmed drainer report, a vault deposit, a first stake of 1,000+ HEIM or a first Pay job of 10+ USDG. The new wallet gets 25.
- Set `REFERRAL_SALT` on Shield before launch and never change it, or every invite code changes.

## RPC providers

Shield, the monitor, the keeper and the web server each try `RPC_URL…` (Alchemy), then `RPC_URL…_BACKUP` (a second paid provider, e.g. QuickNode), then the public endpoint. The status page shows which one answered and marks the RPC "degraded" while a backup is serving.

## Webhooks

API key owners register one HTTPS endpoint at `/app/keys`. Events: `shield.deny`, `shield.warn` (checks made with their keys) and `wallet.risky_approval` (up to 20 watched wallets). Each POST is signed (`heimdall-signature`, HMAC-SHA256); after 15 failures in a row a webhook switches itself off. Local and private-network URLs are refused.

## Wallet Watch (browser alerts)

- Generate the keys once: `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:security@heimdall.fund`) on Shield. Without them `/v1/watch` answers 503 and the button stays hidden.
- The monitor runs Wallet Watch every `WATCH_EVERY_MIN` minutes (15): it calls `POST /v1/admin/watch/run?limit=200` until every watched wallet was re-checked once. A re-check reads only the blocks since the last one and reuses the last report when nothing changed (about 2 RPC calls).
- Developer webhooks ride on the same pass for the wallets listed in a webhook, and work without VAPID keys.
- Watch alerts on new risky approvals only. It does not see outgoing transfers.

## Browser tests

`apps/web/e2e/run.sh` deploys everything on a local mainnet fork (as `scripts/rehearsal.sh` does), points Shield and a fork build of the web at it, and clicks through Wallet Check + revoke, a Pay job, an Auto-Invest plan, staking, the admin panel, early access and the status page with a stand-in wallet. Run it before every web release.

## Monitoring

`apps/monitor` checks every vault every few minutes and posts to the ops webhook on:
- trade losses above a threshold
- the daily loss budget running low
- stale feeds
- a full deposit cap
- a paused vault
- Shield API downtime

It also runs the hourly Wallet Watch pass and posts status heartbeats. Keep it running before deposits open.

## Price feeds (verified onchain 2026-11-23)

Vault assets are priced by `HeimdallStockFeed` adapters that the deploy script creates, one per stock:

- Source: Chainlink **24/7** stock feeds on Robinhood Chain, divided by Chainlink **USDG/USD** (`0x61B7…9aD2`), so NAV is in USDG.
- The adapter reports *stale* while Robinhood has paused the token's oracle for a corporate action (`oraclePaused()`), when USDG/USD is older than `usdgFeedMaxAge`, or when USDG/USD leaves 0.90–1.10. Stale = the vault refuses deposits and NAV withdrawals; in-kind exits keep working.

| Stock | Token | Chainlink 24/7 feed |
|---|---|---|
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | `0x321A36e441DfBadA01Aa6f9884F14a344E133D1F` |
| TSLA | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` | `0x39eDf5ef54150A30d2C4F1b982FbB8f93050BC37` |
| GOOGL | `0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3` | `0x53e040D2C8c9278cBc4b702328aC652068a0E063` |

Other stocks only have 24/5 feeds, which hold their last price through weekends with no heartbeat. Do not add them until a weekend-aware policy exists. The full list comes from Chainlink's `feeds-robinhood-mainnet.json`; re-check it before every new asset.

**Multiplier:** Robinhood's feeds already return the price of one token, share price × `uiMultiplier()` (dividends and splits, ERC-8056). Never multiply again. The adapter also reports stale when the token's `effectiveAt()` is newer than the feed's last update, so a price from before a multiplier change is never used.

**Corporate actions:** the monitor posts an alert when a stock token's oracle is paused or a multiplier change is scheduled. When a stock token's oracle is paused, its vaults go stale on their own. No action is needed; watch the monitor and tell depositors that in-kind exit stays available. If a feed is retired, deploy a new adapter and call `setFeed(token, adapter, 90000)` from the Safe (`OP=set-feed`).
