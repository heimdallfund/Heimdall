import { describe, expect, it, beforeEach } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, encodeFunctionData, hexToBytes, maxUint256, parseAbi, verifyTypedData, keccak256, type PublicClient } from "viem";
import { addressFromSpki, kmsSigner, parseDerSignature, getSigner, prelaunch, resetSigner, type KmsLike } from "../src/signer.js";
import { MemoryStore } from "../src/store.js";
import { limitsFromEnv, sha256 } from "../src/limits.js";
import { buildApp } from "../src/server.js";
import { receiptDomain, RECEIPT_TYPES } from "../src/receipt.js";

// ── a fake AWS KMS backed by a real secp256k1 key ──
const SPKI_PREFIX = "3056301006072a8648ce3d020106052b8104000a034200";
function derInt(n: bigint) {
  let h = n.toString(16); if (h.length % 2) h = "0" + h;
  if (parseInt(h.slice(0, 2), 16) & 0x80) h = "00" + h;
  return "02" + (h.length / 2).toString(16).padStart(2, "0") + h;
}
function fakeKms(forceHighS = false): KmsLike & { address: string } {
  const sk = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(sk, false); // 65 bytes
  const spki = hexToBytes(`0x${SPKI_PREFIX}${bytesToHex(pub).slice(2)}`);
  return {
    address: addressFromSpki(spki),
    async send(cmd: any) {
      if (cmd.constructor.name === "GetPublicKeyCommand") return { PublicKey: spki };
      const sig = secp256k1.sign(cmd.input.Message, sk, { lowS: true });
      const s = forceHighS ? secp256k1.CURVE.n - sig.s : sig.s; // KMS may return high-s
      const body = derInt(sig.r) + derInt(s);
      return { Signature: hexToBytes(`0x30${(body.length / 2).toString(16).padStart(2, "0")}${body}`) };
    },
  };
}

const typed = (agent: `0x${string}`) => ({
  domain: receiptDomain(4663), types: RECEIPT_TYPES, primaryType: "Receipt" as const,
  message: { agent, target: agent, dataHash: keccak256("0x1234"), value: 0n, verdict: 0, expiresAt: 1n, checkId: keccak256("0x01") },
});

describe("KMS receipt signer", () => {
  for (const highS of [false, true]) {
    it(`produces a valid EIP-712 signature (KMS ${highS ? "high-s" : "low-s"})`, async () => {
      const kms = fakeKms(highS);
      const signer = await kmsSigner("key-1", kms);
      expect(signer.address).toBe(kms.address);
      const def = typed(signer.address);
      const sig = await signer.signTypedData(def);
      expect(await verifyTypedData({ ...def, address: signer.address, signature: sig })).toBe(true);
      const sValue = BigInt(`0x${sig.slice(66, 130)}`);
      expect(sValue <= secp256k1.CURVE.n / 2n).toBe(true);
    });
  }

  it("parses DER signatures", () => {
    const r = 123456789n, s = 987654321n;
    const body = derInt(r) + derInt(s);
    expect(parseDerSignature(hexToBytes(`0x30${(body.length / 2).toString(16).padStart(2, "0")}${body}`))).toEqual({ r, s });
  });

  it("refuses to start in production without a signer", async () => {
    resetSigner();
    await expect(getSigner({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).rejects.toThrow(/No receipt signer/);
    resetSigner();
  });

  it("pre-launch mode: answers checks and health, signs nothing, and ends once a key is set", async () => {
    const env = { NODE_ENV: "production", SHIELD_PRELAUNCH: "1" } as NodeJS.ProcessEnv;
    expect(prelaunch(env)).toBe(true);
    expect(prelaunch({ ...env, SHIELD_KMS_KEY_ID: "key-1" })).toBe(false);
    // an env signer key can sit in place before launch: no receipts until the flag is removed
    const keyed = { ...env, SHIELD_SIGNER_KEY: "0x" + "22".repeat(32) } as NodeJS.ProcessEnv;
    expect(prelaunch(keyed)).toBe(true);
    resetSigner();
    await expect(getSigner(keyed)).rejects.toThrow(/Pre-launch mode/);
    resetSigner();
    const { SHIELD_PRELAUNCH: _, ...launched } = keyed;
    expect((await getSigner(launched as NodeJS.ProcessEnv)).address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    resetSigner();
    await expect(getSigner(env)).rejects.toThrow(/Pre-launch mode/);
    resetSigner();
    const app = buildApp({ env, store: new MemoryStore(), getClient: () => ({ getBlockNumber: async () => 7n }) as never, log: () => {} });
    const h = await (await app.request("/health")).json() as { ok: boolean; mode: string };
    expect([h.ok, h.mode]).toEqual([true, "prelaunch"]);
    const s = await (await app.request("/v1/signer")).json() as { signer: string | null; kind: string };
    expect([s.signer, s.kind]).toEqual([null, "prelaunch"]);
  });
});

// ── API keys, rate limits and quotas ──
const okClient = {
  getCode: async () => "0x6080",
  getBalance: async () => 10n ** 18n,
  getBlockNumber: async () => 1n,
  readContract: async ({ functionName }: { functionName: string }) => (functionName === "symbol" ? "USDG" : functionName === "decimals" ? 6 : 10n ** 30n),
  request: async () => [{ calls: [{ status: "0x1", gasUsed: "0x1", logs: [] }] }],
} as unknown as PublicClient;

const KEY = "hd_live_test_123";
const body = (from = "0x1111111111111111111111111111111111111111") => JSON.stringify({
  from, to: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  data: encodeFunctionData({ abi: parseAbi(["function approve(address,uint256)"]), functionName: "approve", args: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", maxUint256] }),
});
function app(env: Record<string, string> = {}) {
  const e = { SHIELD_API_KEYS: `acme:${sha256(KEY).toString("hex")}`, SHIELD_FREE_RPM: "3", SHIELD_FREE_DAILY: "2", ...env } as NodeJS.ProcessEnv;
  return buildApp({ env: e, getClient: () => okClient, store: new MemoryStore(), limits: limitsFromEnv(e), log: () => {} });
}
const post = (a: ReturnType<typeof app>, headers: Record<string, string> = {}, b = body()) =>
  a.request("/v1/check", { method: "POST", body: b, headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9", ...headers } });

describe("Shield API limits", () => {
  beforeEach(() => resetSigner());

  it("rejects a wrong API key and accepts a valid one as pro", async () => {
    const a = app();
    expect((await post(a, { authorization: "Bearer nope" })).status).toBe(401);
    const ok = await post(a, { authorization: `Bearer ${KEY}` });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-ratelimit-limit")).toBe("600");
  });

  it("can require a key", async () => {
    expect((await post(app({ SHIELD_REQUIRE_KEY: "true" }))).status).toBe(401);
  });

  it("enforces the free daily quota per agent wallet", async () => {
    const a = app();
    expect((await post(a)).status).toBe(200);
    const second = await post(a);
    expect(second.headers.get("x-heimdall-quota-remaining")).toBe("0");
    expect((await post(a)).status).toBe(429);
    expect((await post(a, {}, body("0x2222222222222222222222222222222222222222"))).status).toBe(429); // per-minute limit (3) now hit for this IP
  });

  it("rate-limits anonymous callers per minute", async () => {
    const a = app({ SHIELD_FREE_DAILY: "1000" });
    for (let i = 0; i < 3; i++) expect((await post(a)).status).toBe(200);
    const blocked = await post(a);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect((await post(a, { "x-forwarded-for": "8.8.8.8" })).status).toBe(200);
  });

  it("counts verdicts in /v1/stats and reports health", async () => {
    const a = app({ SHIELD_FREE_DAILY: "1000" });
    await post(a);
    const stats = await (await a.request("/v1/stats")).json() as { checks: number; warned: number };
    expect(stats.checks).toBe(1);
    expect(stats.warned).toBe(1); // unlimited approval to an unknown contract
    expect((await a.request("/health")).status).toBe(200);
  });

  it("rejects oversized bodies", async () => {
    const res = await post(app(), {}, JSON.stringify({ from: "0x1111111111111111111111111111111111111111", data: "0x" + "00".repeat(200_000) }));
    expect(res.status).toBe(413);
  });
});

describe("$HEIM holder quota", () => {
  it("gives holders a 5x free daily quota", async () => {
    const HEIM = "0x9999999999999999999999999999999999999999";
    const holder = { ...okClient, readContract: async (a: { address: string; functionName: string }) => (a.address === HEIM ? 10n ** 24n : (okClient as any).readContract(a)) } as unknown as PublicClient;
    const e = { SHIELD_FREE_RPM: "1000", SHIELD_FREE_DAILY: "1", HEIM_ADDRESS: HEIM, HEIM_HOLDER_MIN: "1000" } as NodeJS.ProcessEnv;
    const a = buildApp({ env: e, getClient: () => holder, store: new MemoryStore(), limits: limitsFromEnv(e), log: () => {} });
    for (let i = 0; i < 5; i++) expect((await post(a)).status).toBe(200);
    expect((await post(a)).status).toBe(429);
  });
});

describe("hosted MCP relay", () => {
  beforeEach(() => resetSigner());
  it("counts relayed callers under their own IP only with the relay key; a forged client-ip header is ignored", async () => {
    const RELAY = "relay-secret";
    const a = app({ SHIELD_FREE_DAILY: "1000", SHIELD_RELAY_KEY_SHA256: sha256(RELAY).toString("hex") });
    const as = (ip: string, key?: string) => post(a, { "x-heimdall-client-ip": ip, ...(key ? { "x-heimdall-relay": key } : {}) });
    for (let i = 0; i < 3; i++) expect((await as("1.1.1.1", RELAY)).status).toBe(200);
    expect((await as("1.1.1.1", RELAY)).status).toBe(429);
    expect((await as("2.2.2.2", RELAY)).status).toBe(200);
    // without the key the header means nothing: these count against the real IP 9.9.9.9
    for (let i = 0; i < 3; i++) expect((await as("3.3.3.3", "wrong")).status).toBe(200);
    expect((await as("4.4.4.4")).status).toBe(429);
  });
});

describe("Shareable verdicts, threats and agents endpoints", () => {
  beforeEach(() => resetSigner());
  it("stores a shared check without its receipt and serves it back", async () => {
    process.env.SHIELD_SIGNER_KEY = "0x" + "11".repeat(32);
    const a = app();
    const b = JSON.parse(body());
    const r = await a.request("/v1/check", { method: "POST", body: JSON.stringify({ ...b, share: true }), headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` } });
    const j = await r.json() as { shareId: string; checkId: string };
    expect(j.shareId).toBe(j.checkId);
    const v = await (await a.request(`/v1/verdicts/${j.shareId}`)).json() as { tx: { from: string }; result: { verdict: string; receipt?: unknown } };
    expect(v.tx.from).toBe(b.from);
    expect(v.result.receipt).toBeUndefined();
    expect((await a.request(`/v1/verdicts/0x${"00".repeat(32)}`)).status).toBe(404);
    const agent = await (await a.request(`/v1/agents/${b.from}`)).json() as { checks: number };
    expect(agent.checks).toBe(1);
    const t = await (await a.request("/v1/threats")).json() as { window: string; blocklist: unknown[] };
    expect(t.window).toBe("7d");
    delete process.env.SHIELD_SIGNER_KEY;
  });

  it("keeps probe lookups off agent stats and the Threat Board", async () => {
    process.env.SHIELD_SIGNER_KEY = "0x" + "11".repeat(32);
    const a = app();
    const b = JSON.parse(body());
    const r = await a.request("/v1/check", { method: "POST", body: JSON.stringify({ ...b, probe: true }), headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` } });
    expect(r.status).toBe(200);
    const agent = await (await a.request(`/v1/agents/${b.from}`)).json() as { checks: number };
    expect(agent.checks).toBe(0);
    delete process.env.SHIELD_SIGNER_KEY;
  });
});

describe("Points and reports endpoints", () => {
  it("serves rules and the leaderboard, guards reports and admin routes", async () => {
    const a = app();
    expect((await a.request("/v1/points/rules")).status).toBe(200);
    expect(await (await a.request("/v1/points/leaderboard")).json()).toEqual([]);
    expect((await a.request(`/v1/points/0x${"11".repeat(20)}`)).status).toBe(200);
    const rep = await a.request("/v1/reports", { method: "POST", body: JSON.stringify({ address: `0x${"33".repeat(20)}`, evidence: "https://x.io/tx/1" }), headers: { "content-type": "application/json" } });
    expect(rep.status).toBe(401);
    expect((await a.request("/v1/reports")).status).toBe(403);
    expect((await a.request("/v1/points/deposits", { method: "POST", body: "{}", headers: { "content-type": "application/json", "x-admin-key": "nope" } })).status).toBe(403);
    expect((await a.request("/v1/wallet/0xnope")).status).toBe(400);
  });
});
