import { describe, it, expect } from "vitest";
import { MemoryStore } from "../src/store.js";
import { currentSeason, recordSnapshots, standings, type Season } from "../src/arena.js";

const H = 3_600_000, D = 24 * H;
const T0 = Date.UTC(2026, 11, 1);
const season: Season = { id: 1, name: "Season 1", start: T0, end: T0 + 30 * D, minTvl: 500, minDepositors: 3 };
const A = "0x1111111111111111111111111111111111111111", B = "0x2222222222222222222222222222222222222222", C = "0x3333333333333333333333333333333333333333";

describe("Agent Arena", () => {
  it("ranks eligible vaults by season return and reports drawdown", async () => {
    const s = new MemoryStore();
    const path = { [A]: [1, 1.05, 0.98, 1.12], [B]: [1, 1.02, 1.04, 1.06], [C]: [1, 1.5, 1.6, 1.7] } as Record<string, number[]>;
    for (let i = 0; i < 4; i++) {
      await recordSnapshots(s, T0 + i * 12 * H, [
        { vault: A, name: "Alpha", manager: "0xa", pps: path[A]![i]!, tvl: 5_000, depositors: 12 },
        { vault: B, name: "Steady", manager: "0xb", pps: path[B]![i]!, tvl: 2_000, depositors: 4 },
        { vault: C, name: "Tiny", manager: "0xc", pps: path[C]![i]!, tvl: 100, depositors: 1 },
      ]);
    }
    const st = await standings(s, season, T0 + 3 * D);
    expect(st.map((x) => [x.name, x.rank, x.returnPct])).toEqual([["Alpha", 1, 12], ["Steady", 2, 6], ["Tiny", undefined, 70]]);
    expect(st[0]!.maxDrawdownPct).toBeCloseTo(6.67, 1);
    expect(st[2]!.reason).toMatch(/TVL below/);
    expect(st[0]!.spark.length).toBeGreaterThan(1);
  });

  it("keeps at most one point per 30 minutes and picks the running season", async () => {
    const s = new MemoryStore();
    await recordSnapshots(s, T0, [{ vault: A, name: "A", manager: "0xa", pps: 1, tvl: 1_000 }]);
    await recordSnapshots(s, T0 + 10 * 60_000, [{ vault: A, name: "A", manager: "0xa", pps: 2, tvl: 1_000 }]);
    expect(JSON.parse((await s.fetch(`arena:series:${A}`))!)).toHaveLength(1);
    const next: Season = { ...season, id: 2, start: season.end, end: season.end + 30 * D };
    expect(currentSeason([season, next], T0 + D)?.id).toBe(1);
    expect(currentSeason([season, next], T0 - D)?.id).toBe(1); // upcoming
    expect(currentSeason([season, next], next.start + D)?.id).toBe(2);
  });
});
