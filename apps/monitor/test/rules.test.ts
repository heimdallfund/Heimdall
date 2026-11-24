import { describe, expect, it, vi } from "vitest";
import { diff, evaluate, format, toPause, type Snapshot, type VaultSnapshot } from "../src/rules.js";
import { webhook } from "../src/notify.js";

const U = (n: number) => BigInt(Math.round(n * 1e6));
const vault = (o: Partial<VaultSnapshot> = {}): VaultSnapshot => ({
  address: "0x1111111111111111111111111111111111111111", name: "Guardian Balanced", paused: false, nav: U(5_000), staleAssets: [],
  depositCap: U(10_000), maxDailyLossBps: 500, lossWindowStart: 1_000, lossWindowNav: U(5_000), lossWindowLoss: 0n, execs: [], ...o,
});
const snap = (vaults: VaultSnapshot[], o: Partial<Snapshot> = {}): Snapshot => ({ now: 2_000, shieldOk: true, vaults, ...o });

describe("rules", () => {
  it("is quiet for a healthy vault", () => {
    expect(evaluate(snap([vault()]))).toEqual([]);
  });
  it("flags shield down, pause and stale feeds", () => {
    const keys = evaluate(snap([vault({ paused: true, nav: null, staleAssets: ["NVDA"] })], { shieldOk: false })).map((a) => a.key);
    expect(keys).toEqual(["shield:down", expect.stringMatching(/:paused$/), expect.stringMatching(/:stale$/)]);
  });
  it("flags losing trades above the threshold, critical from 2.5%", () => {
    const a = evaluate(snap([vault({ execs: [{ tx: "0xaa", navBefore: U(5_000), navAfter: U(4_990) }, { tx: "0xbb", navBefore: U(5_000), navAfter: U(4_940) }, { tx: "0xcc", navBefore: U(5_000), navAfter: U(4_870) }] })]));
    expect(a.map((x) => x.severity)).toEqual(["warning", "critical"]);
  });
  it("warns when the daily loss budget is mostly used, only inside the window", () => {
    expect(evaluate(snap([vault({ lossWindowLoss: U(200) })]))[0].title).toMatch(/80% used/);
    expect(evaluate(snap([vault({ lossWindowLoss: U(200) })], { now: 1_000 + 86_401 }))).toEqual([]);
  });
  it("notes a nearly full deposit cap, ignoring unlimited caps", () => {
    expect(evaluate(snap([vault({ nav: U(9_700) })]))[0].key).toMatch(/:cap$/);
    expect(evaluate(snap([vault({ nav: U(9_700), depositCap: 2n ** 256n - 1n })]))).toEqual([]);
  });
});

describe("diff and delivery", () => {
  it("fires once, then resolves", () => {
    const a = evaluate(snap([vault({ paused: true })]));
    const first = diff(new Set(), a);
    expect(first.fire).toHaveLength(1);
    const again = diff(first.active, a);
    expect(again.fire).toHaveLength(0);
    const cleared = diff(again.active, []);
    expect(cleared.resolved).toEqual([a[0].key]);
  });
  it("posts alerts to Discord, Slack or ntfy webhooks in their own shape", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    const msg = format({ key: "k", severity: "critical", title: "Vault paused", detail: "x & y" });
    await webhook("https://discord.com/api/webhooks/1/abc", f as unknown as typeof fetch)(msg);
    await webhook("https://hooks.slack.com/services/T/B/X", f as unknown as typeof fetch)(msg);
    await webhook("https://ntfy.sh/heimdall-ops", f as unknown as typeof fetch)(msg);
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(calls[0][1].body as string).content).toContain("Vault paused");
    expect(JSON.parse(calls[1][1].body as string).text).toContain("x & y");
    expect(calls[2][1].body).toBe(msg);
  });
});

import { depositSnapshot, postSnapshot } from "../src/jobs.js";
describe("daily jobs", () => {
  it("values every vault holder and posts the snapshot with the admin key", async () => {
    const H = "0x1111111111111111111111111111111111111111";
    const client = {
      getBlockNumber: async () => 100n,
      readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) =>
        functionName === "vaultCount" ? 1n : functionName === "allVaults" ? "0x2222222222222222222222222222222222222222"
        : functionName === "balanceOf" ? (String(args?.[0]).toLowerCase() === H ? 10n ** 18n : 0n) : 2_500_000_000n,
      getLogs: async () => [{ args: { from: "0x0000000000000000000000000000000000000000", to: H, value: 1n } }],
    };
    const snap = await depositSnapshot(client as never, "0x3333333333333333333333333333333333333333", 0n);
    expect(snap).toEqual({ [H]: 2500 });
    const f = vi.fn(async () => new Response(JSON.stringify({ awarded: 25 }), { status: 200 }));
    expect(await postSnapshot("https://api.x", "k", "2026-11-23", snap, f as unknown as typeof fetch)).toEqual({ awarded: 25 });
    expect(((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>)["x-admin-key"]).toBe("k");
  });

  it("guardian pauses on a theft-sized trade or a mostly used loss budget, never twice", () => {
    expect(toPause(snap([vault()]))).toEqual([]);
    const trade = toPause(snap([vault({ execs: [{ tx: "0xaa", navBefore: U(5_000), navAfter: U(4_890) }] })]));
    expect(trade).toHaveLength(1);
    expect(trade[0].reason).toMatch(/2\.20%/);
    expect(toPause(snap([vault({ execs: [{ tx: "0xaa", navBefore: U(5_000), navAfter: U(4_960) }] })]))).toEqual([]);
    expect(toPause(snap([vault({ lossWindowLoss: U(160) })]))[0].reason).toMatch(/64% of the 24h loss budget/);
    expect(toPause(snap([vault({ lossWindowLoss: U(160), paused: true })]))).toEqual([]);
  });
});
