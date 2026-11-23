// Fails if any deployable contract's runtime code exceeds EIP-170 (24,576 bytes). Run after a production build.
import { readFileSync, readdirSync } from "node:fs";
const LIMIT = 24_576;
let bad = 0;
for (const dir of readdirSync("artifacts/contracts")) {
  if (!dir.endsWith(".sol")) continue;
  const name = dir.slice(0, -4);
  let a;
  try { a = JSON.parse(readFileSync(`artifacts/contracts/${dir}/${name}.json`, "utf8")); } catch { continue; }
  const size = (a.deployedBytecode.length - 2) / 2;
  if (size === 0) continue;
  const flag = size > LIMIT ? "OVER" : "ok";
  if (size > LIMIT) bad++;
  console.log(`${flag.padEnd(4)} ${name.padEnd(26)} ${size.toString().padStart(6)} bytes (${(LIMIT - size).toString().padStart(6)} left)`);
}
if (bad) { console.error(`${bad} contract(s) over the EIP-170 limit`); process.exit(1); }
