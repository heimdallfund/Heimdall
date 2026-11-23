import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HeimdallShield } from "@heimdallfund/sdk";
import type { PublicClient } from "viem";
import { buildServer, startHttp, type Deps } from "../src/index.js";

const ID = "0x" + "ab".repeat(32);
const DRAINER = "0x3333333333333333333333333333333333333333";
const deny = { checkId: ID, verdict: "DENY", riskScore: 95, summary: ["Approves unlimited USDG to a wallet"], findings: [{ code: "UNLIMITED_APPROVAL_TO_EOA", severity: "deny", message: "Unlimited approval to an EOA" }], simulation: { success: true }, approvals: [{ spender: DRAINER, unlimited: true }] };
const calls: { path: string; body?: any }[] = [];
const fakeFetch = (async (url: string, init?: RequestInit) => {
  const path = new URL(url).pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ path, body });
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
  if (path === "/v1/check") return json(body.share ? { ...deny, shareId: ID } : deny);
  if (path === "/v1/check-signature") return json({ ...deny, verdict: "DENY" });
  if (path === "/v1/threats") return json({ window: "7d", codes: [{ code: "UNLIMITED_APPROVAL_TO_EOA", count: 3 }], targets: [{ address: DRAINER, denies: 2, blocklisted: true }], recent: [{ at: Date.UTC(2026, 10, 23, 5), kind: "tx", target: DRAINER, codes: ["UNLIMITED_APPROVAL_TO_EOA"], summary: "Approves unlimited USDG to a wallet" }], blocklist: [{ address: DRAINER, label: "Inferno Drainer" }] });
  if (path.startsWith("/v1/agents/")) return json({ address: path.split("/").pop(), checks: 10, allowed: 8, warned: 1, denied: 1, firstSeen: Date.UTC(2026, 10, 1), lastSeen: Date.UTC(2026, 10, 23) });
  if (path.startsWith("/v1/wallet/")) return json({ owner: DRAINER, block: "1", scannedAt: 0, approvals: [{ kind: "erc20", token: DRAINER, symbol: "USDG", decimals: 6, spender: DRAINER, spenderLabel: null, spenderIsContract: false, allowance: "unlimited", unlimited: true, expiresAt: null, balance: "2500", atRiskUsd: 2500, risk: "danger", reasons: ["Spender is a plain wallet"] }], summary: { total: 1, danger: 1, review: 0, atRiskUsd: 2500 }, sources: [], complete: true, progress: 100 });
  if (path === "/v1/arena") return json({ season: { id: 1, name: "Season 1", start: Date.UTC(2026, 11, 1), end: Date.UTC(2026, 11, 31), minTvl: 500, minDepositors: 3 }, standings: [{ vault: DRAINER, name: "Alpha", manager: DRAINER, returnPct: 12.5, maxDrawdownPct: 3.1, tvl: 5000, depositors: 9, eligible: true, rank: 1 }] });
  if (path.startsWith("/v1/verdicts/")) return json({ kind: "tx", at: Date.UTC(2026, 10, 23), chainId: 4663, result: deny });
  return json({ error: "not_found" }, 404);
}) as typeof fetch;

const client = {
  getCode: async () => "0x",
  readContract: async ({ functionName, args }: { functionName: string; args: unknown[] }) => {
    if (functionName === "getJob") return { client: "0x1111111111111111111111111111111111111111", provider: DRAINER, arbiter: "0x0000000000000000000000000000000000000000", amount: 25_000_000n, deadline: 1795000000n, reviewWindow: 86400, submittedAt: 0n, arbiterFeeBps: 0, feeBps: 100, status: Number(args[0]) === 7 ? 0 : 1, specHash: "0x" + "ab".repeat(32), resultHash: "0x" + "00".repeat(32) };
    if (functionName === "jobsOfProvider" || functionName === "jobsOfClient") return [3n];
    return 2n;
  },
  getTransaction: async () => ({ from: "0x1111111111111111111111111111111111111111", to: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", input: "0x095ea7b3", value: 0n, blockNumber: 5n }),
} as unknown as PublicClient;
const deps: Deps = { shield: new HeimdallShield({ baseUrl: "https://api.test", fetch: fakeFetch }), client, chainId: 4663, webUrl: "https://heimdall.test", pay: "0x9999999999999999999999999999999999999999" };

async function connect() {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer(deps).connect(a);
  const c = new Client({ name: "t", version: "1" });
  await c.connect(b);
  return c;
}
const textOf = (r: any) => r.content.map((x: any) => x.text).join("\n");

test("lists all tools, the safe_send prompt and server instructions", async () => {
  const c = await connect();
  const names = (await c.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["heimdall_agent_reputation", "heimdall_arena", "heimdall_check_address", "heimdall_check_signature", "heimdall_check_transaction", "heimdall_check_tx_hash", "heimdall_get_verdict", "heimdall_list_signals", "heimdall_list_vaults", "heimdall_passport", "heimdall_pay_job", "heimdall_pay_jobs", "heimdall_risk", "heimdall_threats", "heimdall_vault_info", "heimdall_wallet_check"]);
  assert.equal((await c.listPrompts()).prompts[0].name, "safe_send");
  assert.match(c.getInstructions() ?? "", /heimdall_check_signature/);
});

test("check_transaction returns DENY, the advice and a share link", async () => {
  const c = await connect();
  const r = await c.callTool({ name: "heimdall_check_transaction", arguments: { from: "0x1111111111111111111111111111111111111111", to: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", data: "0x095ea7b3", share: true } });
  const t = textOf(r);
  assert.match(t, /Verdict: DENY/);
  assert.match(t, /Do not sign/);
  assert.match(t, new RegExp(`https://heimdall.test/v/${ID}`));
  assert.equal(calls.at(-1)?.body.share, true);
});

test("check_signature requires exactly one payload and reports spenders", async () => {
  const c = await connect();
  const bad = await c.callTool({ name: "heimdall_check_signature", arguments: { signer: DRAINER } });
  assert.equal(bad.isError, true);
  const ok = await c.callTool({ name: "heimdall_check_signature", arguments: { signer: "0x1111111111111111111111111111111111111111", typedData: { primaryType: "Permit", message: { spender: DRAINER } } } });
  assert.match(textOf(ok), /Grants spending rights to: 0x3333.*\(unlimited\)/);
  assert.equal(calls.at(-1)?.path, "/v1/check-signature");
});

test("check_address combines blocklist, denials, EOA type and a simulated approval from a throwaway wallet", async () => {
  const c = await connect();
  const t = textOf(await c.callTool({ name: "heimdall_check_address", arguments: { address: DRAINER } }));
  assert.match(t, /BLOCKLISTED: Inferno Drainer/);
  assert.match(t, /Denied 2 time/);
  assert.match(t, /wallet \(EOA\)/);
  assert.match(t, /approval → DENY/);
  const sim = calls.filter((x) => x.path === "/v1/check").at(-1)!;
  assert.notEqual(sim.body.from.toLowerCase(), DRAINER);
  assert.equal(sim.body.probe, true, "lookups stay off the Threat Board");
});

test("tx hash, threats, agent reputation and verdict tools", async () => {
  const c = await connect();
  assert.match(textOf(await c.callTool({ name: "heimdall_check_tx_hash", arguments: { hash: ID } })), /mined in block 5[\s\S]*DENY/);
  assert.match(textOf(await c.callTool({ name: "heimdall_threats", arguments: {} })), /UNLIMITED_APPROVAL_TO_EOA: 3[\s\S]*blocklisted/);
  assert.match(textOf(await c.callTool({ name: "heimdall_agent_reputation", arguments: { address: DRAINER } })), /Checks: 10 .* \(10\.0% denied\)/);
  assert.match(textOf(await c.callTool({ name: "heimdall_get_verdict", arguments: { id: ID } })), /Transaction checked 2026-11-23/);
});

test("wallet_check lists risky approvals and links to revoke", async () => {
  const c = await connect();
  const t = textOf(await c.callTool({ name: "heimdall_wallet_check", arguments: { address: DRAINER } }));
  assert.match(t, /1 dangerous.*\$2,500 at risk/);
  assert.match(t, /\[DANGER\] USDG unlimited/);
  assert.match(t, /heimdall.test\/check\//);
});

test("Heimdall Pay tools read jobs and provider records", async () => {
  const c = await connect();
  const list = textOf(await c.callTool({ name: "heimdall_pay_jobs", arguments: { address: DRAINER } }));
  assert.match(list, /2 completed, 2 disputed/);
  assert.match(list, /#3 Open · 25 USDG/);
  const one = textOf(await c.callTool({ name: "heimdall_pay_job", arguments: { id: 3 } }));
  assert.match(one, /none \(no disputes\)/);
  assert.match(one, /heimdall.test\/pay\/job\/3/);
  assert.equal((await c.callTool({ name: "heimdall_pay_job", arguments: { id: 7 } })).isError, true);
});

test("arena lists the season standings", async () => {
  const c = await connect();
  assert.match(textOf(await c.callTool({ name: "heimdall_arena", arguments: {} })), /#1 Alpha .* \+12\.5% · worst drop −3\.1%/);
});

test("a Shield outage is reported as DENY, never as safe", async () => {
  const down = { ...deps, shield: new HeimdallShield({ baseUrl: "https://api.test", fetch: (async () => new Response("{}", { status: 503 })) as typeof fetch }) };
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildServer(down).connect(a);
  const c = new Client({ name: "t", version: "1" }); await c.connect(b);
  const r = await c.callTool({ name: "heimdall_check_transaction", arguments: { from: DRAINER } });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /treat the transaction as unsafe \(DENY\)/i);
});

test("remote mode answers MCP over Streamable HTTP", async () => {
  const srv = startHttp(0, deps);
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as { port: number }).port;
  const h = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const init = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) });
  assert.equal(init.status, 200);
  assert.equal((await init.json()).result.serverInfo.name, "heimdall");
  const list = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
  assert.equal((await list.json()).result.tools.length, 16);
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
  srv.close();
});
