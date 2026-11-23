/** Launch day, in order. Each step says where it happens and how to know it worked. Details: contracts/RUNBOOK.md. */
export type Step = { id: string; title: string; detail: string; code?: string };
export type Phase = { id: string; title: string; when: string; steps: Step[] };

export const PHASES: Phase[] = [
  {
    id: "before", title: "Before the day", when: "Days ahead",
    steps: [
      { id: "audit-report", title: "Independent audit report in, every fix reviewed", detail: "The auditor's fix review covers the exact commit you will deploy. Note that commit." },
      { id: "safe-ready", title: "Admin Safe ready on Robinhood Chain", detail: "Safe 1.4.1 with every signer added and a test transaction signed by the threshold." },
      { id: "kms-signer", title: "Shield signer key in AWS KMS", detail: "secp256k1 key (ECC_SECG_P256K1). Its address becomes shieldSigner in the deploy config." },
      { id: "upstash", title: "Upstash Redis for the Shield API", detail: "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN on the heimdall-shield Vercel project." },
      { id: "rpc", title: "Paid RPC and a backup", detail: "Alchemy plus a second provider: RPC_URL_MAINNET / _BACKUP on Shield, RPC_URL / RPC_URL_BACKUP on the monitor." },
      { id: "hot-keys", title: "Hot keys funded with a little ETH", detail: "Deployer (used once), monitor reporter (RISK_REPORTER_KEY), passport publisher (PASSPORT_KEY), x402 facilitator (X402_FACILITATOR_KEY), keeper (KEEPER_KEY). None of them ever holds user funds." },
      { id: "blocklist", title: "Bring Shield's blocklist up to date", detail: "apps/shield/data/blocklist.json holds 5 publicly reported scam tokens and wallets (RIALTO, World, SCAMCOIN, VLAD), each with its source. Add any newer reports before launch: the Risk Oracle starts from this list." },
      { id: "config", title: "Deploy config filled", detail: "contracts/deploy/robinhood.config.json from the example: adminSafe, treasury, shieldSigner, riskReporter." },
      { id: "npm-org", title: "npm organization heimdallfund", detail: "Free organization on npmjs.com named heimdallfund (the @heimdall scope is taken), npm login with two-factor on. Dry run must pass.", code: "node packages/release.mjs" },
      { id: "rehearsal", title: "Rehearsal passes on a fresh fork", detail: "Deploys everything, runs both Safe batches and real money through every product. Expect 32/32.", code: "cd contracts && bash scripts/rehearsal.sh" },
    ],
  },
  {
    id: "deploy", title: "Deploy", when: "T-0",
    steps: [
      { id: "size", title: "Production build under the size limit", detail: "Fails if any contract is over 24,576 bytes.", code: "npm run size" },
      { id: "deploy-core", title: "Deploy the contracts", detail: "Vault factory, Signals, Pay, Auto-Invest, Risk Oracle, Guard module and price adapters. Writes the Safe batch to deployments/.", code: "npm run deploy" },
      { id: "accept-ownership", title: "Safe accepts ownership", detail: "Transaction Builder → import deployments/robinhood.safe-accept-ownership.json → review → execute." },
      { id: "verify", title: "Verify sources on Blockscout", detail: "Every contract shows a green check on the explorer.", code: "npx hardhat verify --network robinhood <address> <constructor args…>" },
      { id: "staking", title: "$HEIM staking and fee splitter", detail: "After the token exists: deploy-staking.ts, then the Safe executes robinhood.safe-route-fees.json." },
    ],
  },
  {
    id: "wire", title: "Wire up", when: "T+30 min",
    steps: [
      { id: "shield-live", title: "Shield API goes live", detail: "On heimdall-shield: add SHIELD_KMS_KEY_ID and the contract addresses (HEIMDALL_PAY_ADDRESS, RISK_ORACLE_ADDRESS, HEIM_HOLDER_ADDRESS, HEIMDALL_STAKING_ADDRESS, PASSPORT_PUBLISHER_ADDRESS), delete SHIELD_PRELAUNCH, redeploy. /health must say mode \"live\" and /v1/signer must show the KMS address." },
      { id: "x402-on", title: "x402 on", detail: "X402_PAY_TO (treasury) and X402_FACILITATOR_KEY on Shield. /x402/supported lists eip155:4663." },
      { id: "monitor-up", title: "Monitor container running", detail: "FACTORY, AUTOINVEST, SPLITTER, USDG, RISK_ORACLE, RISK_REPORTER_KEY, PASSPORT_KEY, KEEPER_KEY, SHIELD_API_URL, SHIELD_ADMIN_KEY. The status page shows its first heartbeat." },
      { id: "reporter", title: "Reporter appointed on the Risk Oracle", detail: "Skip if riskReporter was in the deploy config. Otherwise the Safe calls setReporter(<monitor reporter>, true)." },
      { id: "web-env", title: "Web env set and redeployed", detail: "NEXT_PUBLIC_FACTORY_ADDRESS, _SIGNALS_, _PAY_, _AUTOINVEST_, _RISK_ORACLE_, _GUARD_MODULE_, _STAKING_, _SPLITTER_, _HEIM_, _HEIM_HOLDER_ADDRESS, NEXT_PUBLIC_API_URL and SHIELD_API_URL on heimdall-web." },
      { id: "domains", title: "Domains attached", detail: "heimdall.fund → heimdall-web, api.heimdall.fund → heimdall-shield. HTTPS works on both." },
    ],
  },
  {
    id: "smoke", title: "Smoke test with small money", when: "T+1 h",
    steps: [
      { id: "risk-sync", title: "First Risk Oracle sync", detail: "The monitor log shows a sync; GET /v1/risk/<a blocklisted address> shows it onchain." },
      { id: "shield-check", title: "A Shield check signs a receipt", detail: "From Claude or Cursor with the MCP server, check a transaction: the answer carries a receipt from the KMS signer.", code: "claude mcp add heimdall -- npx -y @heimdallfund/mcp" },
      { id: "vault-cycle", title: "Vault round trip", detail: "Create a vault, deposit 10 USDG, let the reference agent run one real cycle, then redeemInKind." },
      { id: "pay-job", title: "One Pay job end to end", detail: "1 USDG job: create, submit, release. The provider receives 0.99 USDG and the splitter 0.01." },
      { id: "guard-safe", title: "Guard on a real Safe", detail: "Use the /guard builder on a test Safe with a 5 USDG daily limit; one agent payment goes through, a second over the limit is refused." },
    ],
  },
  {
    id: "open", title: "Open the doors", when: "T+2 h",
    steps: [
      { id: "unlock", title: "Unlock the site", detail: "Turn off Vercel deployment protection for production on heimdall-web." },
      { id: "addresses", title: "Publish the addresses", detail: "docs/build/contracts.md and the security page list every deployed contract with its explorer link." },
      { id: "npm-publish", title: "Publish the SDK, MCP server and agent kit", detail: "@heimdallfund/sdk, agent-kit, mcp and plugin-heimdall, in that order. Then the MCP Registry and the ElizaOS plugin (packages/PUBLISHING.md).", code: "node packages/release.mjs --publish --otp <code>" },
      { id: "gitbook", title: "Docs live on GitBook", detail: "Sync from the docs/ folder; check the Integrate pages render." },
      { id: "status-green", title: "Status page green for an hour", detail: "Shield, RPC, monitor and keeper all up with no incident." },
      { id: "announce", title: "Launch post on X", detail: "Posted and pinned." },
    ],
  },
];

export const ALL_STEPS = PHASES.flatMap((p) => p.steps);
