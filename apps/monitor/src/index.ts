/**
 * Long-running monitor and keeper (one container). The same jobs also run as a Vercel cron (api/cron.ts).
 *   npm start           loop forever, every INTERVAL_SEC (120)
 *   npm run once        one pass of every job
 */
import process from "node:process";
import { webhook } from "./notify.js";
import { emptyState, runOnce } from "./runner.js";

const env = process.env;
const state = emptyState(env);

if (process.argv.includes("--once")) {
  const r = await runOnce(env, state);
  if (r.errors.length) { console.error(r.errors.join("\n")); process.exitCode = 1; }
} else {
  if (env.FACTORY) await webhook(env.ALERT_WEBHOOK_URL)(`🛡 Heimdall monitor started\nWatching factory ${env.FACTORY}`);
  const intervalMs = Number(env.INTERVAL_SEC ?? 120) * 1000;
  for (;;) {
    await runOnce(env, state).catch((e) => console.error("pass failed", e));
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
