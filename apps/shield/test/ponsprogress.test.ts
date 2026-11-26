import { describe, expect, it } from "vitest";
import { ponsProgress } from "../src/launchpad.js";

describe("ponsProgress", () => {
  const supply = 10n ** 27n, threshold = 42n * 10n ** 17n;
  it("counts only real ETH raised, not the curve's 1.68 ETH virtual reserve", () => {
    // $HEIM's curve on 2026-11-26: 3.7568 ETH reserve of which 1.68 is virtual → 2.0768 real of 4.2
    expect(ponsProgress([3756847642636362521n, 447183426054792681701559232n], threshold, supply)).toBeCloseTo(49.44, 1);
  });
  it("is 0 at launch and 100 at the threshold", () => {
    const v = 168n * 10n ** 16n;
    expect(ponsProgress([v, supply], threshold, supply)).toBe(0);
    const r0 = v + threshold; // k = v × supply
    expect(ponsProgress([r0, (v * supply) / r0], threshold, supply)).toBeGreaterThan(99.9);
  });
  it("needs reserves, threshold and supply", () => {
    expect(ponsProgress(null, threshold, supply)).toBeNull();
    expect(ponsProgress([1n, 1n], 0n, supply)).toBeNull();
  });
});
