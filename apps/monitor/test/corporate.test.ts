import { describe, it, expect } from "vitest";
import { corporateActions, formatCorporateAction } from "../src/jobs.js";

const T = { NVDA: "0xd0601CE157DB5BdC3162BBaC2a2C8aF5320d9EEc", TSLA: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", AAPL: "0xaF3D76f1834a1D425780943C99EA8a608f8A93F9" } as const;
const state: Record<string, Record<string, unknown>> = {
  [T.NVDA]: { oraclePaused: false, uiMultiplier: 1000775159164630595n, newUIMultiplier: 0n, effectiveAt: 1788998430n },             // past change: quiet
  [T.TSLA]: { oraclePaused: false, uiMultiplier: 10n ** 18n, newUIMultiplier: 3n * 10n ** 18n, effectiveAt: 2_000_000_000n },       // 3:1 split ahead
  [T.AAPL]: { oraclePaused: true, uiMultiplier: 1001090616965388660n, newUIMultiplier: 0n, effectiveAt: 1794449600n },              // paused now
};
const client = { readContract: async ({ address, functionName }: { address: string; functionName: string }) => state[address]![functionName] } as never;

describe("corporate actions", () => {
  it("flags paused oracles and scheduled multiplier changes, and ignores past ones", async () => {
    const r = await corporateActions(client, T, 1_795_000_000);
    expect(r.map((a) => a.symbol)).toEqual(["TSLA", "AAPL"]);
    expect(r[0]).toMatchObject({ paused: false, multiplier: 1, next: { multiplier: 3, at: 2_000_000_000 } });
    expect(r[1]).toMatchObject({ paused: true });
    expect(formatCorporateAction(r[0]!)).toContain("1.000000 → 3.000000 at 2033-05-18 03:33:20 UTC");
    expect(formatCorporateAction(r[1]!)).toContain("In-kind exits still work");
  });
});
