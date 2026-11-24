import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/handler.js";

const env = { HEIMDALL_API_URL: "https://shield.test", SHIELD_RELAY_KEY: "relay-key", RPC_URL: "http://127.0.0.1:1" };
const rpc = (id: number, method: string, params: unknown = {}) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const req = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://mcp.test/mcp", { method: "POST", body, headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "203.0.113.7", ...headers } });

function stubShield() {
  const seen: { url: string; headers: Headers }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    return Response.json({ checkId: "0x01", verdict: "DENY", riskScore: 95, summary: ["Approves an unlimited amount"], findings: [{ code: "BLOCKLISTED_TARGET", severity: "deny", message: "Known drainer" }], approvals: [], assetChanges: [], simulation: { ok: true, available: true } });
  }) as typeof fetch;
  return { f, seen };
}

test("initializes and lists the Heimdall tools over Streamable HTTP", async () => {
  const init = await handle(req(rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } })), env);
  assert.equal(init.status, 200);
  assert.equal(init.headers.get("access-control-allow-origin"), "*");
  const body = await init.json() as { result: { serverInfo: { name: string } } };
  assert.equal(body.result.serverInfo.name, "heimdall");
  const list = await handle(req(rpc(2, "tools/list"), { "mcp-protocol-version": "2025-06-18" }), env);
  const names = ((await list.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  for (const n of ["heimdall_check_transaction", "heimdall_check_signature", "heimdall_check_address", "heimdall_wallet_check"]) assert.ok(names.includes(n), n);
});

test("a tool call reaches Shield with the relay key and the caller's IP, and returns the verdict", async () => {
  const { f, seen } = stubShield();
  const call = rpc(3, "tools/call", { name: "heimdall_check_transaction", arguments: { from: "0x1111111111111111111111111111111111111111", to: "0x2323a3d19c6181b0e854209f405e6fdef6ad821d" } });
  const r = await handle(req(call, { "mcp-protocol-version": "2025-06-18" }), env, f);
  const out = (await r.json()) as { result: { content: { text: string }[] } };
  assert.match(out.result.content[0]!.text, /Verdict: DENY/);
  assert.equal(seen[0]!.url, "https://shield.test/v1/check");
  assert.equal(seen[0]!.headers.get("x-heimdall-relay"), "relay-key");
  assert.equal(seen[0]!.headers.get("x-heimdall-client-ip"), "203.0.113.7");
});

test("a caller with its own API key is billed to that key, with no relay headers", async () => {
  const { f, seen } = stubShield();
  const call = rpc(4, "tools/call", { name: "heimdall_check_transaction", arguments: { from: "0x1111111111111111111111111111111111111111", to: "0x2222222222222222222222222222222222222222" } });
  await handle(req(call, { "mcp-protocol-version": "2025-06-18", authorization: "Bearer hd_live_abcdefgh123" }), env, f);
  assert.equal(seen[0]!.headers.get("authorization"), "Bearer hd_live_abcdefgh123");
  assert.equal(seen[0]!.headers.get("x-heimdall-relay"), null);
});

test("answers GET with a description and refuses other methods and huge bodies", async () => {
  assert.equal((await handle(new Request("https://mcp.test/mcp"), env)).status, 200);
  assert.equal((await handle(new Request("https://mcp.test/mcp", { method: "PUT" }), env)).status, 405);
  assert.equal((await handle(new Request("https://mcp.test/mcp", { method: "POST", body: "x", headers: { "content-length": String(300 * 1024) } }), env)).status, 413);
});
