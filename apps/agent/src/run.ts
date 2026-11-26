/**
 * One agent cycle from environment settings: used by the CLI (index.ts) and by the Vercel cron (api/cron.ts).
 * All settings: .env.example
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, fallback, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HeimdallShield, robinhoodChain } from "@heimdallfund/sdk";
import { runOnce, shieldProvider, voucherSignals, type AgentConfig } from "./agent.js";
import { uniswapV3 } from "./router.js";

export type Env = Record<string, string | undefined>;

export async function cycle(env: Env, opts: { dryRun?: boolean; log?: (s: string) => void } = {}) {
  const need = (k: string) => { const v = env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
  const log = opts.log ?? ((s: string) => console.log(`${new Date().toISOString()} ${s}`));
  const transport = fallback([...(env.RPC_URL_MAINNET ? [http(env.RPC_URL_MAINNET)] : []), http()]);
  const client = createPublicClient({ chain: robinhoodChain, transport }) as PublicClient;
  const manager = createWalletClient({ chain: robinhoodChain, transport, account: privateKeyToAccount(need("MANAGER_KEY") as Hex) });
  const lower = (j: string | undefined) => Object.fromEntries(Object.entries(JSON.parse(j ?? "{}") as Record<string, number | string>).map(([k, v]) => [k.toLowerCase(), v]));
  const fees = lower(env.POOL_FEES) as Record<string, number>;
  const cfg: AgentConfig = {
    vault: need("VAULT") as Address,
    usdg: (env.USDG_ADDRESS ?? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168") as Address,
    // POOL_FEES: {"0xtoken": 500, ...} for pools on different fee tiers; POOL_FEE is the fallback
    router: uniswapV3(need("ROUTER_ADDRESS") as Address, (a, b) => fees[a.toLowerCase()] ?? fees[b.toLowerCase()] ?? Number(env.POOL_FEE ?? 3000)),
    targetsBps: lower(need("TARGETS")) as Record<string, number>,
    bandBps: Number(env.BAND_BPS ?? 500),
    slippageBps: Number(env.SLIPPAGE_BPS ?? 100),
    signalIds: { tokenRisk: env.SIGNAL_ID_TOKEN_RISK ? BigInt(env.SIGNAL_ID_TOKEN_RISK) : undefined, stockPremium: env.SIGNAL_ID_STOCK_PREMIUM ? BigInt(env.SIGNAL_ID_STOCK_PREMIUM) : undefined },
    signalPrices: { tokenRisk: BigInt(env.PRICE_TOKEN_RISK ?? 20_000), stockPremium: BigInt(env.PRICE_STOCK_PREMIUM ?? 50_000) },
    symbols: env.SYMBOLS ? lower(env.SYMBOLS) as Record<string, string> : undefined,
  };
  const stateFile = env.STATE_FILE ?? ".agent-state.json";
  let spent: Map<string, bigint>;
  try { spent = new Map(Object.entries(JSON.parse(readFileSync(stateFile, "utf8")).spent as Record<string, string>).map(([k, v]) => [k, BigInt(v)])); } catch { spent = new Map(); }
  const shield = new HeimdallShield({ baseUrl: env.HEIMDALL_API_URL, apiKey: env.HEIMDALL_API_KEY });
  const signals = env.SIGNALS_URL && env.HEIMDALL_SIGNALS_ADDRESS
    ? voucherSignals({ baseUrl: env.SIGNALS_URL, wallet: manager, chainId: robinhoodChain.id, signals: env.HEIMDALL_SIGNALS_ADDRESS as Address, spent, log })
    : undefined;
  const report = await runOnce({ client, manager, receipts: shieldProvider(shield, robinhoodChain.id, { strict: true }), signals, dryRun: !!opts.dryRun, log }, cfg);
  try { writeFileSync(stateFile, JSON.stringify({ spent: Object.fromEntries([...spent].map(([k, v]) => [k, v.toString()])) }, null, 2)); } catch { /* read-only filesystem: vouchers are re-derived from chain */ }
  log(`done: ${report.executed.length} executed, ${report.skipped.length} skipped`);
  return report;
}
