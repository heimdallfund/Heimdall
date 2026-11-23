#!/usr/bin/env node
/**
 * Builds, tests, stages and packs the public Heimdall packages, in dependency order:
 *   @heimdallfund/sdk → @heimdallfund/agent-kit → @heimdallfund/mcp → @heimdallfund/plugin-heimdall
 * Local `file:` dependencies become semver ranges, and a smoke test installs the tarballs into an empty project,
 * imports every entry point and talks to the MCP server over stdio. Nothing is published without --publish.
 *
 *   node packages/release.mjs                         # dry run: tarballs in /tmp/heimdall-release
 *   node packages/release.mjs --scope @other          # only if you publish under another npm scope
 *   node packages/release.mjs --publish [--otp 123456]
 */
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const BASE = "@heimdallfund"; // the npm organization the packages are named for (@heimdall is taken on npm)
const SCOPE = arg("--scope") ?? BASE;
const PUBLISH = process.argv.includes("--publish");
const OTP = arg("--otp");
const OUT = "/tmp/heimdall-release";
const ORDER = ["sdk", "agent-kit", "mcp", "plugin-heimdall"];
const run = (cmd, args, cwd, quiet = true) => execFileSync(cmd, args, { cwd, stdio: quiet ? "pipe" : "inherit", encoding: "utf8" });
const rescope = (s) => (SCOPE === BASE ? s : s.replaceAll(`${BASE}/`, `${SCOPE}/`));

rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const versions = Object.fromEntries(ORDER.map((p) => [`${BASE}/${p}`, JSON.parse(readFileSync(join(here, p, "package.json"), "utf8")).version]));
const tarballs = {};

function walk(dir, fn) { for (const f of readdirSync(dir)) { const p = join(dir, f); statSync(p).isDirectory() ? walk(p, fn) : fn(p); } }

for (const pkg of ORDER) {
  const src = join(here, pkg), stage = join(OUT, pkg);
  const json = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
  console.log(`\n── ${rescope(json.name)}@${json.version}`);
  if (pkg !== "plugin-heimdall") {
    run("npm", ["run", "build"], src); console.log("   built");
    run("npm", ["test"], src); console.log("   tests pass");
  }
  mkdirSync(stage, { recursive: true });
  for (const f of [...json.files, ...(pkg === "plugin-heimdall" ? ["src", "tsconfig.json"] : [])]) if (existsSync(join(src, f))) cpSync(join(src, f), join(stage, f), { recursive: true });
  // package.json: scope, and file: deps → ^version of what this release publishes
  const deps = Object.fromEntries(Object.entries(json.dependencies ?? {}).map(([k, v]) => [rescope(k), String(v).startsWith("file:") || versions[k] ? `^${versions[k]}` : v]));
  const out = { ...json, name: rescope(json.name), dependencies: deps };
  delete out.devDependencies; if (pkg === "plugin-heimdall") out.devDependencies = json.devDependencies;
  writeFileSync(join(stage, "package.json"), JSON.stringify(out, null, 2) + "\n");
  if (SCOPE !== BASE) walk(stage, (p) => { if (/\.(js|ts|md|json)$/.test(p) && !p.endsWith("package.json")) writeFileSync(p, rescope(readFileSync(p, "utf8"))); });
  if (pkg === "plugin-heimdall") {
    // build the plugin against the staged agent-kit tarball, exactly as a user would install it
    run("npm", ["install", "--no-audit", "--no-fund", ...Object.values(tarballs), "@elizaos/core@^2", "typescript@^7", "@types/node"], stage);
    run("npx", ["tsc", "-p", "tsconfig.json"], stage); console.log("   built against the staged agent-kit");
    rmSync(join(stage, "node_modules"), { recursive: true, force: true }); rmSync(join(stage, "package-lock.json"), { force: true });
    const pj = JSON.parse(readFileSync(join(stage, "package.json"), "utf8")); delete pj.devDependencies; writeFileSync(join(stage, "package.json"), JSON.stringify(pj, null, 2) + "\n");
  }
  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", OUT], stage))[0];
  tarballs[pkg] = join(OUT, packed.filename);
  console.log(`   ${packed.filename} · ${packed.entryCount} files · ${(packed.size / 1024).toFixed(1)} kB`);
  const bad = packed.files.filter((f) => /(^|\/)(src|test|\.env|node_modules)\b|\.test\.|tsconfig/.test(f.path) && pkg !== "plugin-heimdall");
  if (bad.length) throw new Error(`unexpected files in ${packed.filename}: ${bad.map((f) => f.path).join(", ")}`);
}

if (existsSync(join(here, "mcp", "server.json"))) {
  const sj = JSON.parse(readFileSync(join(here, "mcp", "server.json"), "utf8"));
  sj.version = versions[`${BASE}/mcp`]; sj.packages[0].version = sj.version; sj.packages[0].identifier = rescope(`${BASE}/mcp`);
  writeFileSync(join(OUT, "server.json"), JSON.stringify(sj, null, 2) + "\n");
}

// ── smoke test: empty project, install the tarballs, import every entry point, MCP initialize + tools/list
console.log("\n── smoke test");
const smoke = join(OUT, "smoke"); mkdirSync(smoke);
writeFileSync(join(smoke, "package.json"), JSON.stringify({ name: "smoke", private: true, type: "module" }));
run("npm", ["install", "--no-audit", "--no-fund", ...Object.values(tarballs), "ai@^7", "@langchain/core@^1", "@elizaos/core@^2"], smoke);
const S = SCOPE;
writeFileSync(join(smoke, "imports.mjs"), `
const sdk = await import("${S}/sdk"); if (typeof sdk.HeimdallShield !== "function") throw new Error("sdk");
for (const p of ["", "/ai-sdk", "/langchain", "/eliza"]) await import("${S}/agent-kit" + p);
const { heimdallAiTools } = await import("${S}/agent-kit/ai-sdk"); if (Object.keys(heimdallAiTools()).length < 5) throw new Error("ai-sdk tools");
const { heimdallLangChainTools } = await import("${S}/agent-kit/langchain"); if (heimdallLangChainTools().length < 5) throw new Error("langchain tools");
const plugin = (await import("${S}/plugin-heimdall")).default; if (!plugin.actions?.length) throw new Error("eliza plugin");
console.log("   imports ok: sdk, agent-kit (core, ai-sdk, langchain, eliza), plugin with " + plugin.actions.length + " actions");
`);
console.log(run("node", ["imports.mjs"], smoke).trim());
const tools = await new Promise((resolve, reject) => {
  const p = spawn("node", [join(smoke, "node_modules/.bin/heimdall-mcp")], { cwd: smoke, stdio: ["pipe", "pipe", "pipe"] });
  let buf = ""; const timer = setTimeout(() => { p.kill(); reject(new Error("MCP server did not answer")); }, 15000);
  p.stdout.on("data", (d) => { buf += d; for (const line of buf.split("\n")) { try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); p.kill(); resolve(m.result.tools.length); } } catch {} } });
  const send = (m) => p.stdin.write(JSON.stringify(m) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "release-smoke", version: "0" } } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
});
console.log(`   MCP over stdio: ${tools} tools`);

if (!PUBLISH) {
  console.log(`\nDry run done. Tarballs and server.json in ${OUT}.\nPublish: npm login, then node packages/release.mjs --publish${SCOPE !== BASE ? ` --scope ${SCOPE}` : ""}`);
} else {
  for (const pkg of ORDER) {
    console.log(`publishing ${tarballs[pkg]}`);
    run("npm", ["publish", tarballs[pkg], "--access", "public", ...(OTP ? ["--otp", OTP] : [])], OUT, false);
  }
  console.log("\nPublished. MCP Registry: mcp-publisher login dns --domain heimdall.fund, then mcp-publisher publish /tmp/heimdall-release/server.json");
}
