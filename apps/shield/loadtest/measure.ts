/**
 * Counts what each user action costs in RPC calls (by method) and Upstash commands, against Robinhood Chain mainnet.
 * Feeds the infrastructure cost model.   npx tsx loadtest/measure.ts
 */
import { createPublicClient, custom, encodeFunctionData, erc20Abi, http, parseAbiItem, type PublicClient } from "viem";
import { buildApp } from "../src/server.js";
import { MemoryStore } from "../src/store.js";
import { limitsFromEnv } from "../src/limits.js";
import { robinhoodMainnet } from "../src/chains.js";

const RPC = process.env.RPC_URL_MAINNET ?? "https://rpc.mainnet.chain.robinhood.com";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const calls = new Map<string, number>();
const base = http(RPC, { retryCount: 2, timeout: 20_000 })({});
const client = createPublicClient({ chain: robinhoodMainnet, transport: custom({ request: async ({ method, params }) => { calls.set(method, (calls.get(method) ?? 0) + 1); return base.request({ method, params } as never); } }) }) as PublicClient;

// Upstash bills commands: incr is INCR + EXPIRE (2), every other operation is 1.
let commands = 0;
class Counting extends MemoryStore {
  override async incr(k: string, t: number, by?: number) { commands += 2; return super.incr(k, t, by); }
  override async get(k: string) { commands++; return super.get(k); }
  override async put(k: string, v: string, t?: number) { commands++; return super.put(k, v, t); }
  override async fetch(k: string) { commands++; return super.fetch(k); }
  override async remove(k: string) { commands++; return super.remove(k); }
  override async addMember(k: string, m: string) { commands++; return super.addMember(k, m); }
  override async removeMember(k: string, m: string) { commands++; return super.removeMember(k, m); }
  override async members(k: string) { commands++; return super.members(k); }
}
const env = { ...process.env, NODE_ENV: "test", SHIELD_FREE_DAILY: "100000", SHIELD_FREE_RPM: "100000", EXPLORER_API_URL: "http://127.0.0.1:9" } as NodeJS.ProcessEnv;
const store = new Counting();
const app = buildApp({ env, getClient: () => client, store, limits: limitsFromEnv(env), log: () => {} });

const latest = await client.getBlockNumber();
const logs = await client.getLogs({ address: USDG, event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"), fromBlock: latest - 2_000n, toBlock: latest });
const wallet = logs.map((l) => l.args.from!).find((a) => a && !/^0x0{40}$/i.test(a))!;
calls.clear();

async function measure(name: string, fn: () => Promise<unknown>) {
  calls.clear(); commands = 0;
  const t = Date.now(); await fn(); const ms = Date.now() - t;
  const rpc = [...calls.values()].reduce((a, b) => a + b, 0);
  const row = { action: name, rpc, byMethod: Object.fromEntries(calls), upstash: commands, ms };
  console.log(JSON.stringify(row));
  return row;
}
const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.text());
const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: ["0x000000000000000000000000000000000000dEaD", 1n] });

const rows = [
  await measure("shield_check_first", () => post("/v1/check", { chainId: 4663, from: wallet, to: USDG, data: transfer, value: "0" })),
  await measure("shield_check_repeat", () => post("/v1/check", { chainId: 4663, from: wallet, to: USDG, data: transfer, value: "0" })),
  await measure("signature_check", () => post("/v1/check-signature", { chainId: 4663, signer: wallet, message: "hello" })),
  await measure("wallet_scan_fresh", () => app.request(`/v1/wallet/${wallet}`).then((r) => r.text())),
  await measure("wallet_scan_cached", () => app.request(`/v1/wallet/${wallet}`).then((r) => r.text())),
  await (async () => { for (let i = 0; i < 10; i++) { const j = await app.request(`/v1/wallet/${wallet}?refresh=1`).then((r) => r.json()) as { complete?: boolean }; if (j.complete) break; } })(),
  await measure("wallet_scan_incremental", () => app.request(`/v1/wallet/${wallet}?refresh=1`).then((r) => r.text())),
  await measure("threat_board", () => app.request("/v1/threats").then((r) => r.text())),
  await measure("status_page", () => app.request("/v1/status").then((r) => r.text())),
  await (async () => { await store.remove("memo:status"); })(),
  await measure("status_page_uptime_memo", () => app.request("/v1/status").then((r) => r.text())),
  await measure("status_page_cached", () => app.request("/v1/status").then((r) => r.text())),
  await measure("threat_board_cached", () => app.request("/v1/threats").then((r) => r.text())),
  await measure("event_pageview", () => post("/v1/events", { name: "pageview", path: "/check" })),
];
console.log("\nRESULT " + JSON.stringify(rows));
