import { describe, expect, it } from "vitest";
import { pad, toHex, type Hex, type PublicClient } from "viem";
import { runTokenWatch, subscribeToken, tokenEvents, verdictChange, type TokenMeta } from "../src/tokenwatch.js";
import { MemoryStore } from "../src/store.js";
import type { TokenCheck } from "../src/tokencheck.js";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TOKEN = "0x00000000000000000000000000000000000000aa";
const CURVE = "0x00000000000000000000000000000000000000cc";
const DEV = "0x1111111111111111111111111111111111111111";
const WHALE = "0x2222222222222222222222222222222222222222";
const t = (a: string) => pad(a as Hex).toLowerCase() as Hex;
const amt = (n: bigint) => pad(toHex(n)) as Hex;
const SUPPLY = 1_000_000n * 10n ** 18n;
const meta: TokenMeta = { symbol: "MEME", supply: SUPPLY.toString(), dev: DEV, market: [CURVE], v3Pool: null, v4PoolId: null, graduated: false };

const logsWith = (transfers: { topics: Hex[]; data: Hex }[]) => ({
  getBlockNumber: async () => 2_000n,
  request: async ({ params }: { params: [{ topics: string[] }] }) => (params[0].topics[0] === TRANSFER ? transfers : []),
}) as unknown as PublicClient;

const check = (over: Partial<TokenCheck>) => ({
  token: TOKEN, symbol: "MEME", verdict: "ALLOW", riskScore: 0, findings: [], sell: { ok: true, taxPct: 0 }, totalSupply: SUPPLY.toString(),
  launch: { launchpad: "Pons", model: "curve", dev: DEV, curve: CURVE, graduated: false, progressPct: 40 }, pool: null, ...over,
}) as unknown as TokenCheck;

describe("Token Watch", () => {
  it("sees the dev selling and a whale dumping, and ignores small trades", async () => {
    const logs = logsWith([
      { topics: [TRANSFER, t(DEV), t(CURVE)], data: amt(SUPPLY / 50n) },      // dev sells 2%
      { topics: [TRANSFER, t(WHALE), t(CURVE)], data: amt(SUPPLY / 20n) },    // whale sells 5%
      { topics: [TRANSFER, t(CURVE), t(WHALE)], data: amt(SUPPLY / 1000n) },  // a buy
      { topics: [TRANSFER, t("0x3333333333333333333333333333333333333333"), t(CURVE)], data: amt(SUPPLY / 1000n) }, // 0.1% sell
    ]);
    const a = await tokenEvents(logs, logs, TOKEN, meta, 1_000n, 2_000n);
    expect(a.map((x) => x.kind)).toEqual(["dev_sold", "whale_sold"]);
    expect(a[0]!.title).toContain("2.0%");
    expect(a[1]!.title).toContain("5.0%");
  });

  it("alerts when Token Check gets worse or the token graduates, not when it stays the same", () => {
    const prev = { verdict: "ALLOW" as const, codes: [], sellTax: 0, at: 0 };
    expect(verdictChange(prev, check({}), meta).alerts).toEqual([]);
    const worse = verdictChange(prev, check({ verdict: "DENY", findings: [{ code: "HONEYPOT", severity: "deny", message: "Selling reverts." }] }), meta);
    expect(worse.alerts[0]).toMatchObject({ kind: "verdict_worse", title: "MEME: Token Check now says DENY", body: "Selling reverts." });
    const grad = verdictChange(prev, check({ launch: { launchpad: "Pons", model: "curve", dev: DEV, graduated: true, progressPct: 100 } as never, pool: { version: 4, address: "0xabc", fee: 0, pair: "ETH", liquidity: "1" } }), meta);
    expect(grad.alerts.map((x) => x.kind)).toEqual(["graduated"]);
    expect(grad.meta.v4PoolId).toBe("0xabc");
  });

  it("subscribes, then notifies the browser once per pass with the worst alert first", async () => {
    const store = new MemoryStore();
    const sub = { endpoint: "https://push.example.com/abc1234567", keys: { p256dh: "p", auth: "a" } };
    expect((await subscribeToken(store, TOKEN, sub, async () => check({}))).ok).toBe(true);
    await store.put(`twatch:last:${TOKEN}`, "1000");
    await store.put(`twatch:verdict:${TOKEN}`, JSON.stringify({ verdict: "ALLOW", codes: [], sellTax: 0, at: 0 })); // due for a re-check
    const sent: string[] = [];
    const logs = logsWith([{ topics: [TRANSFER, t(DEV), t(CURVE)], data: amt(SUPPLY / 10n) }]);
    const r = await runTokenWatch(store, { logs, client: logs, check: async () => check({ verdict: "WARN", findings: [{ code: "DEV_SOLD", severity: "warn", message: "The dev sold." }] }), send: async (_s, p) => { sent.push(p); return {}; } });
    expect(r).toMatchObject({ watched: 1, scanned: 1, notified: 1 });
    const p = JSON.parse(sent[0]!);
    expect(p.title).toContain("Token Check now says WARN");
    expect(p.body).toContain("the dev sold 10.0% of the supply");
    expect(p.url).toContain(`/token-check/0x`);
  });
});
