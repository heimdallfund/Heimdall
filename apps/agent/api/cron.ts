/**
 * Vercel cron (vercel.json): one agent cycle. Vercel calls it with `Authorization: Bearer $CRON_SECRET`; anything else
 * is refused. The manager key lives only in the project's Sensitive env (MANAGER_KEY): it can trade the vault through
 * Shield-checked calls, never withdraw.
 */
import process from "node:process";
import { cycle } from "../src/run.js";

export const maxDuration = 300;

export async function GET(request: Request) {
  const env = process.env;
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return new Response("forbidden", { status: 403 });
  const lines: string[] = [];
  try {
    const r = await cycle({ ...env, STATE_FILE: env.STATE_FILE ?? "/tmp/agent-state.json" }, { log: (s) => { lines.push(s); console.log(s); } });
    return Response.json({ ok: true, executed: r.executed.length, skipped: r.skipped.length, log: lines });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message, log: lines }, { status: 500 });
  }
}
