import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store.js";
import { agentStats, loadVerdict, recordCheck, saveVerdict, threats } from "../src/insights.js";

const W = "0x1111111111111111111111111111111111111111", T = "0x3333333333333333333333333333333333333333";
const res = (verdict: "ALLOW" | "WARN" | "DENY", code = "UNLIMITED_APPROVAL_TO_EOA") => ({
  checkId: `0x${"ab".repeat(32)}`, verdict, riskScore: verdict === "DENY" ? 90 : 10, summary: ["Approves unlimited USDG"],
  findings: verdict === "ALLOW" ? [] : [{ code, severity: verdict === "DENY" ? "deny" : "warn" }],
});

describe("insights", () => {
  it("counts checks per agent wallet", async () => {
    const s = new MemoryStore();
    await recordCheck(s, { kind: "tx", wallet: W, target: T, result: res("ALLOW") });
    await recordCheck(s, { kind: "tx", wallet: W.toUpperCase().replace("0X", "0x"), target: T, result: res("DENY") });
    const a = await agentStats(s, W);
    expect(a).toMatchObject({ checks: 2, allowed: 1, denied: 1, warned: 0 });
    expect(a.firstSeen).toBeTypeOf("number");
  });
  it("builds the threat board from denials and warnings", async () => {
    const s = new MemoryStore();
    for (let i = 0; i < 3; i++) await recordCheck(s, { kind: "tx", wallet: W, target: T, result: res("DENY") });
    await recordCheck(s, { kind: "tx", wallet: W, target: T, result: res("WARN", "DRAINS_BALANCE") });
    const t = await threats(s);
    expect(t.codes).toEqual([{ code: "UNLIMITED_APPROVAL_TO_EOA", count: 3 }, { code: "DRAINS_BALANCE", count: 1 }]);
    expect(t.targets[0]).toMatchObject({ address: T, denies: 3, blocklisted: false });
    expect(t.recent).toHaveLength(3);
    expect(t.recent[0]).toMatchObject({ target: T, codes: ["UNLIMITED_APPROVAL_TO_EOA"] });
  });
  it("stores and loads shared verdicts", async () => {
    const s = new MemoryStore();
    await saveVerdict(s, `0x${"AB".repeat(32)}`, { kind: "tx", result: { verdict: "DENY" } });
    expect(await loadVerdict(s, `0x${"ab".repeat(32)}`)).toMatchObject({ result: { verdict: "DENY" } });
    expect(await loadVerdict(s, `0x${"cd".repeat(32)}`)).toBeNull();
  });
});
