import { describe, expect, it, afterAll } from "vitest";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { verifyMessage, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildApp } from "../src/server.js";
import { MemoryStore } from "../src/store.js";
import { limitsFromEnv } from "../src/limits.js";
import { deliver, setHook, sign, validHookUrl, verify, getHook } from "../src/webhooks.js";
import { runWatch } from "../src/watch.js";
import { resetBlocklist } from "../src/blocklist.js";

const got: { headers: IncomingHttpHeaders; body: string }[] = [];
let reply = 200;
const server = createServer((req, res) => { let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => { got.push({ headers: req.headers, body }); res.statusCode = reply; res.end("ok"); }); });
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
afterAll(() => server.close());
const waitFor = async (n: number) => { for (let i = 0; i < 100 && got.length < n; i++) await new Promise((r) => setTimeout(r, 20)); };

describe("webhook basics", () => {
  it("accepts only public https endpoints", () => {
    expect(validHookUrl("https://agents.example.com/heimdall")).toBeNull();
    for (const u of ["http://agents.example.com/x", "https://localhost/x", "https://10.0.0.5/x", "https://192.168.1.2/x", "https://169.254.169.254/latest", "https://user:pw@example.com/x", "https://intranet/x", "https://[::1]/x"]) expect(validHookUrl(u)).not.toBeNull();
  });
  it("signs so the receiver can verify, and rejects old or altered events", () => {
    const body = JSON.stringify({ a: 1 });
    const h = sign("whsec_x", body);
    expect(verify("whsec_x", body, h)).toBe(true);
    expect(verify("whsec_y", body, h)).toBe(false);
    expect(verify("whsec_x", body + " ", h)).toBe(false);
    expect(verify("whsec_x", body, sign("whsec_x", body, Math.floor(Date.now() / 1000) - 3600))).toBe(false);
  });
  it("delivers signed events, logs them and switches off after repeated failures", async () => {
    const store = new MemoryStore(); got.length = 0; reply = 200;
    const r = await setHook(store, "0xOwner", { url: URL_, events: ["shield.deny"] }, { allowInsecure: true });
    expect(r.ok && r.secret).toMatch(/^whsec_/);
    const d = await deliver(store, "0xOwner", "shield.deny", { verdict: "DENY" }, fetch, { allowInsecure: true });
    expect(d).toMatchObject({ ok: true, status: 200 });
    expect(verify((r as { secret: string }).secret, got[0]!.body, String(got[0]!.headers["heimdall-signature"]))).toBe(true);
    expect(got[0]!.headers["heimdall-event"]).toBe("shield.deny");
    expect(await deliver(store, "0xOwner", "shield.warn", {}, fetch, { allowInsecure: true })).toBeNull(); // not subscribed
    reply = 500;
    for (let i = 0; i < 15; i++) await deliver(store, "0xOwner", "shield.deny", {}, fetch, { allowInsecure: true });
    expect((await getHook(store, "0xOwner"))!.disabled).toMatch(/Switched off/);
    expect(await deliver(store, "0xOwner", "shield.deny", {}, fetch, { allowInsecure: true })).toBeNull();
    reply = 200;
  });
});

describe("webhooks end to end", () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const client = {
    verifyMessage: (args: Parameters<typeof verifyMessage>[0]) => verifyMessage(args),
    getCode: async () => "0x",
    getBalance: async () => 10n ** 18n,
    readContract: async ({ functionName }: { functionName: string }) => (functionName === "symbol" ? "X" : functionName === "decimals" ? 6 : 10n ** 30n),
    request: async () => [{ calls: [{ status: "0x1", gasUsed: "0x1", logs: [] }] }],
  } as unknown as PublicClient;
  const json = (b: unknown, h: Record<string, string> = {}, method = "POST") => ({ method, body: JSON.stringify(b), headers: { "content-type": "application/json", ...h } });

  it("a key owner registers a webhook and gets a signed event when Shield blocks one of their checks", async () => {
    got.length = 0;
    const env = { SHIELD_FREE_RPM: "1000", NODE_ENV: "test" } as NodeJS.ProcessEnv;
    const store = new MemoryStore();
    const app = buildApp({ env, getClient: () => client, store, limits: limitsFromEnv(env), log: () => {} });
    const { message } = await (await app.request("/v1/auth/challenge", json({ address: owner.address }))).json() as { message: string };
    const { session } = await (await app.request("/v1/auth/verify", json({ address: owner.address, signature: await owner.signMessage({ message }) }))).json() as { session: string };
    const auth = { authorization: `Session ${session}` };
    expect((await app.request("/v1/webhook", { headers: {} })).status).toBe(401);
    const saved = await (await app.request("/v1/webhook", json({ url: URL_, events: ["shield.deny", "shield.warn"], wallets: [owner.address] }, auth, "PUT"))).json() as { ok: boolean; secret: string };
    expect(saved.ok).toBe(true);
    const view = await (await app.request("/v1/webhook", { headers: auth })).json() as { webhook: { secretHint: string; wallets: string[] } };
    expect(JSON.stringify(view)).not.toContain(saved.secret);
    expect(view.webhook.wallets).toEqual([owner.address.toLowerCase()]);
    expect((await (await app.request("/v1/webhook/test", json({}, auth))).json() as { ok: boolean }).ok).toBe(true);

    const { key } = await (await app.request("/v1/keys", json({ name: "bot" }, auth))).json() as { key: string };
    // a transaction to a blocklisted drainer
    process.env.SHIELD_BLOCKLIST = "0x000000000000000000000000000000000000dEaD"; resetBlocklist();
    const res = await app.request("/v1/check", json({ from: owner.address, to: "0x000000000000000000000000000000000000dEaD", data: "0x", value: "1" }, { authorization: `Bearer ${key}` }));
    const verdict = ((await res.json()) as { verdict: string }).verdict;
    expect(["DENY", "WARN"]).toContain(verdict);
    await waitFor(2);
    const evt = JSON.parse(got[1]!.body) as { type: string; data: { verdict: string; from: string; apiKeyId: string } };
    expect(evt.type).toBe(verdict === "DENY" ? "shield.deny" : "shield.warn");
    expect(evt.data.from.toLowerCase()).toBe(owner.address.toLowerCase());
    expect(verify(saved.secret, got[1]!.body, String(got[1]!.headers["heimdall-signature"]))).toBe(true);
  });

  it("Wallet Watch sends risky approvals on watched agent wallets to the webhook, even without browser push", async () => {
    got.length = 0;
    const store = new MemoryStore();
    await setHook(store, "0xowner", { url: URL_, events: ["wallet.risky_approval"], wallets: ["0x1111111111111111111111111111111111111111"] }, { allowInsecure: true });
    let approvals: { risk: string; token: string; symbol: string; spender: string; spenderLabel: string | null; atRiskUsd: number | null }[] = [];
    const scan = async () => ({ approvals });
    const { deliver: d } = await import("../src/webhooks.js");
    const onRisky = async (address: string, fresh: unknown) => { await d(store, "0xowner", "wallet.risky_approval", { wallet: address, approvals: fresh }, fetch, { allowInsecure: true }); };
    await runWatch(store, scan, null, { onRisky }); // first pass records the baseline
    approvals = [{ risk: "danger", token: "0xT", symbol: "USDG", spender: "0xBAD", spenderLabel: null, atRiskUsd: 50 }];
    const r = await runWatch(store, scan, null, { onRisky });
    expect(r.scanned).toBe(1);
    expect(got).toHaveLength(1);
    expect(JSON.parse(got[0]!.body)).toMatchObject({ type: "wallet.risky_approval", data: { wallet: "0x1111111111111111111111111111111111111111" } });
  });
});
