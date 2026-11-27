import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store.js";
import { recordCheck, threats } from "../src/insights.js";
import { isDemoSig, isDemoTx, purgeDemoTraffic } from "../src/demo.js";
import { countVerdict } from "../src/status.js";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const DEMO_APPROVE = "0x095ea7b30000000000000000000000003333333333333333333333333333333333333333ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const REAL = "0x7777777777777777777777777777777777777777", BAD = "0x9999999999999999999999999999999999999999";
const deny = { checkId: `0x${"ab".repeat(32)}`, verdict: "DENY" as const, riskScore: 90, summary: ["x"], findings: [{ code: "UNLIMITED_APPROVAL_TO_EOA", severity: "deny" }] };

describe("demo traffic", () => {
  it("recognises the site's demo samples and nothing else", () => {
    expect(isDemoTx({ from: "0x1111111111111111111111111111111111111111", to: USDG, data: DEMO_APPROVE })).toBe(true);
    expect(isDemoTx({ from: REAL, to: USDG, data: DEMO_APPROVE })).toBe(true); // "approving a random wallet" button
    expect(isDemoTx({ from: "0xD4EB21209C4D6093F80B5B84F5C45CC093EA14A3", to: USDG, data: "0x" })).toBe(true);
    expect(isDemoTx({ from: REAL, to: USDG, data: `0x095ea7b3${"0".repeat(24)}${BAD.slice(2)}${"f".repeat(64)}` })).toBe(false);
    expect(isDemoSig(REAL, "0x3333333333333333333333333333333333333333")).toBe(true);
    expect(isDemoSig(REAL, BAD)).toBe(false);
  });

  it("takes old demo checks back out of the stats and the Threat Board, once", async () => {
    const s = new MemoryStore();
    const demo = "0x1111111111111111111111111111111111111111", t = "0x3333333333333333333333333333333333333333";
    for (let i = 0; i < 3; i++) { await countVerdict(s, "denied"); await recordCheck(s, { kind: "tx", wallet: demo, target: t, result: deny }); }
    await countVerdict(s, "denied"); await recordCheck(s, { kind: "tx", wallet: REAL, target: BAD, result: deny });
    await countVerdict(s, "warned"); // a visitor lookup: counted, never recorded per agent
    expect(await s.get("stats:checks")).toBe(5);

    expect(await purgeDemoTraffic(s)).toBe(true);
    expect(await purgeDemoTraffic(s)).toBe(false);
    expect(await s.get("stats:checks")).toBe(2);
    expect(await s.get("stats:denied")).toBe(1);
    expect(await s.get("stats:warned")).toBe(1);
    const board = await threats(s);
    expect(board.targets.map((x) => x.address)).toEqual([BAD]);
    expect(board.recent).toHaveLength(1);
    expect(board.codes).toEqual([{ code: "UNLIMITED_APPROVAL_TO_EOA", count: 1 }]);
  });
});

describe("revert-only denials", () => {
  const revert = { checkId: `0x${"cd".repeat(32)}`, verdict: "DENY" as const, riskScore: 60, summary: ["Plain transfer"], findings: [{ code: "SIM_REVERTED", severity: "deny" }] };
  const TOKEN = "0x5555555555555555555555555555555555555555";
  it("never puts a target on the Threat Board just because a tx would revert", async () => {
    const s = new MemoryStore();
    await recordCheck(s, { kind: "tx", wallet: REAL, target: TOKEN, result: revert });
    const board = await threats(s);
    expect(board.targets).toEqual([]);
    expect(board.recent).toEqual([]);
    expect(board.codes).toEqual([]);
  });
  it("clears revert-only denials recorded before the rule", async () => {
    const { purgeDemoRecent } = await import("../src/demo.js");
    const s = new MemoryStore();
    await s.incr(`threat:target:${TOKEN}`, 3600); await s.addMember("threat:targets", TOKEN);
    await s.put("threat:recent:0", JSON.stringify({ at: Date.now(), kind: "tx", target: TOKEN, codes: ["SIM_REVERTED"], summary: "x" }));
    await s.incr(`threat:code:${new Date().toISOString().slice(0, 10)}:SIM_REVERTED`, 3600); await s.addMember("threat:codes", "SIM_REVERTED");
    expect(await purgeDemoRecent(s)).toBe(1);
    const board = await threats(s);
    expect(board.targets).toEqual([]);
    expect(board.recent).toEqual([]);
    expect(board.codes).toEqual([]);
  });
});
