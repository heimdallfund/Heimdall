import { describe, expect, it } from "vitest";
import { evaluateDue, outcomeOf, recordPrediction, scorecard } from "../src/bench.js";
import { MemoryStore } from "../src/store.js";
import type { TokenCheck } from "../src/tokencheck.js";

const tc = (verdict: TokenCheck["verdict"], findings: TokenCheck["findings"] = [], devSoldPct: number | null = null) =>
  ({ symbol: "T", verdict, findings, holders: devSoldPct === null ? null : { devSoldPct } }) as unknown as TokenCheck;
const rug = { code: "LIQUIDITY_REMOVED", severity: "deny" as const, message: "Liquidity was removed." };

describe("accuracy scorecard", () => {
  it("keeps the first verdict, judges outcomes a day later, and scores both ways", async () => {
    const s = new MemoryStore();
    const day = 24 * 3_600_000;
    await recordPrediction(s, "0xA", tc("WARN", [{ code: "LP_REMOVABLE", severity: "warn", message: "" }]), 0);
    await recordPrediction(s, "0xA", tc("ALLOW"), 1); // ignored: not the first verdict
    await recordPrediction(s, "0xB", tc("ALLOW"), 0);
    await recordPrediction(s, "0xC", tc("ALLOW"), 0);
    await recordPrediction(s, "0xD", tc("ALLOW"), day); // not due yet
    const later: Record<string, TokenCheck> = { "0xa": tc("DENY", [rug]), "0xb": tc("ALLOW"), "0xc": tc("WARN", [{ code: "HONEYPOT", severity: "deny", message: "Sells revert." }]) };
    expect(await evaluateDue(s, async (t) => later[t]!, 10, day + 1)).toBe(3);
    const card = await scorecard(s);
    expect(card).toMatchObject({ evaluated: 3, pending: 1, bad: 2, caught: 1, passed: 2, passedBad: 1, byOutcome: { rugged: 1, honeypot: 1, dumped: 0, fine: 1 } });
  });

  it("treats a dev selling out as a dump only when they sold nearly all of it", () => {
    const sold = { code: "DEV_SOLD", severity: "warn" as const, message: "The dev sold." };
    expect(outcomeOf(tc("WARN", [sold], 95)).outcome).toBe("dumped");
    expect(outcomeOf(tc("WARN", [sold], 60)).outcome).toBe("fine");
  });
});
