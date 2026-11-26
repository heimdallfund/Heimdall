// Copies the reference agent (apps/agent/src) into the monitor so the monitor's Vercel cron can run it with the key
// it already holds. apps/agent stays the source of truth; test/agent-sync.test.ts fails when the copies drift.
import { copyFileSync } from "node:fs";
for (const f of ["agent.ts", "router.ts", "strategy.ts", "run.ts"]) copyFileSync(new URL(`../../agent/src/${f}`, import.meta.url), new URL(`../src/agent/${f}`, import.meta.url));
console.log("agent synced");
