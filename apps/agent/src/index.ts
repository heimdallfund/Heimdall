/**
 * Heimdall reference manager agent.
 *   npm run dry-run   → read the vault, buy signals, print the plan, trade nothing
 *   npm run once      → one cycle
 *   npm start         → every INTERVAL_MIN minutes
 * All settings: .env.example. On Vercel the same cycle runs from api/cron.ts.
 */
import { cycle } from "./run.js";

const env = process.env;
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const once = args.has("--once") || dryRun;
const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);

await cycle(env, { dryRun, log });
if (!once) setInterval(() => cycle(env, { log }).catch((e) => log(`cycle failed: ${(e as Error).message}`)), Number(env.INTERVAL_MIN ?? 60) * 60_000);
