/**
 * Vercel cron (vercel.json, hourly): one cycle of the reference agent managing Heimdall's own vault. It trades with
 * the monitor's keeper key (KEEPER_KEY), which the admin Safe appointed as the vault's manager: the vault only lets a
 * manager make Shield-checked trades within its loss limits, never withdraw. Settings: AGENT_VAULT, AGENT_ROUTER,
 * AGENT_TARGETS, AGENT_POOL_FEES, AGENT_SYMBOLS (JSON maps keyed by token address).
 */
import process from "node:process";
import { cycle } from "../src/agent/run.js";

export const maxDuration = 300;

export async function GET(request: Request) {
  const env = process.env;
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return new Response("forbidden", { status: 403 });
  if (!env.AGENT_VAULT || !env.KEEPER_KEY) return Response.json({ ok: true, skipped: "agent not configured" });
  const lines: string[] = [];
  try {
    const r = await cycle({
      MANAGER_KEY: env.KEEPER_KEY, VAULT: env.AGENT_VAULT, ROUTER_ADDRESS: env.AGENT_ROUTER, TARGETS: env.AGENT_TARGETS,
      POOL_FEES: env.AGENT_POOL_FEES, SYMBOLS: env.AGENT_SYMBOLS, RPC_URL_MAINNET: env.RPC_URL, HEIMDALL_API_URL: env.SHIELD_API_URL,
      HEIMDALL_API_KEY: env.AGENT_SHIELD_KEY, USDG_ADDRESS: env.USDG, STATE_FILE: "/tmp/agent-state.json",
    }, { log: (s) => { lines.push(s); console.log(s); } });
    return Response.json({ ok: true, executed: r.executed.length, skipped: r.skipped.length, log: lines });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message, log: lines }, { status: 500 });
  }
}
