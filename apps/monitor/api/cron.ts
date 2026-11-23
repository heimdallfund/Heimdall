/**
 * Vercel cron (vercel.json): one pass of every monitor and keeper job. Vercel calls it with
 * `Authorization: Bearer $CRON_SECRET`; anything else is refused. Before launch (no FACTORY) it only posts the
 * heartbeats and the jobs whose settings exist.
 */
import process from "node:process";
import { emptyState, runOnce } from "../src/runner.js";
import { loadState, saveState } from "../src/state.js";

export const maxDuration = 300;

export async function GET(request: Request) {
  const env = process.env;
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return new Response("forbidden", { status: 403 });
  const state = await loadState(env, emptyState(env));
  const r = await runOnce(env, state);
  await saveState(env, state);
  return Response.json({ ok: r.errors.length === 0, launched: r.launched, errors: r.errors });
}
