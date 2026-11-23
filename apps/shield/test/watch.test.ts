import { describe, it, expect } from "vitest";
import { MemoryStore } from "../src/store.js";
import { runWatch, subscribe, unsubscribe, validSubscription, type Scan, type Sender } from "../src/watch.js";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const sub = (n: number) => ({ endpoint: `https://push.example.org/send/${n}`, keys: { p256dh: "BPk", auth: "au" } });
const row = (spender: string, risk = "danger") => ({ risk, token: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", symbol: "USDG", spender, spenderLabel: null, atRiskUsd: 1200 });

describe("Wallet Watch", () => {
  it("records what is there first, then notifies every watching browser once per new risky approval", async () => {
    const s = new MemoryStore();
    await subscribe(s, A, sub(1)); await subscribe(s, A, sub(2));
    let approvals = [row("0x1111111111111111111111111111111111111111", "review")];
    const scan: Scan = async () => ({ approvals });
    const sent: { endpoint: string; payload: string }[] = [];
    const send: Sender = async (x, payload) => { sent.push({ endpoint: x.endpoint, payload }); return {}; };
    expect(await runWatch(s, scan, send)).toMatchObject({ watched: 1, scanned: 1, notified: 0 });
    approvals = [...approvals, row("0x2222222222222222222222222222222222222222")];
    expect((await runWatch(s, scan, send)).notified).toBe(2);
    const p = JSON.parse(sent[0]!.payload);
    expect(p.title).toBe("New risky approval on 0xaaaa…aaaa");
    expect(p.body).toContain("$1,200 at risk");
    expect(p.url).toBe(`https://heimdall.fund/check/${A}`);
    expect((await runWatch(s, scan, send)).notified).toBe(0);   // nothing new
  });

  it("drops push addresses the browser revoked, caps wallets per browser, and unsubscribes", async () => {
    const s = new MemoryStore();
    await subscribe(s, A, sub(1));
    let approvals = [] as ReturnType<typeof row>[];
    const scan: Scan = async () => ({ approvals });
    await runWatch(s, scan, async () => ({}));
    approvals = [row("0x3333333333333333333333333333333333333333")];
    expect(await runWatch(s, scan, async () => ({ gone: true }))).toMatchObject({ removed: 1 });
    expect(await s.members("watch:addresses")).toEqual([]);
    for (let i = 0; i < 5; i++) expect((await subscribe(s, `0x${String(i).repeat(40)}`, sub(9))).ok).toBe(true);
    expect((await subscribe(s, A, sub(9))).ok).toBe(false);
    expect((await unsubscribe(s, sub(9).endpoint, "0x" + "0".repeat(40))).watching).toHaveLength(4);
    expect(validSubscription({ endpoint: "http://insecure", keys: { p256dh: "a", auth: "b" } })).toBe(false);
  });
});
