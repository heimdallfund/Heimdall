import { describe, expect, it } from "vitest";
import { plan, type Holding, type PlanInput } from "../src/strategy.js";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
const NVDA = "0x00000000000000000000000000000000000000a1" as const;
const TSLA = "0x00000000000000000000000000000000000000a2" as const;
const u = (n: number) => BigInt(Math.round(n * 1e6));
const h = (token: `0x${string}`, symbol: string, amountWhole: number, price: number): Holding => ({
  token, symbol, decimals: 18, amount: BigInt(amountWhole) * 10n ** 18n, value: u(amountWhole * price), price: u(price),
});
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  usdg: USDG, usdgBalance: u(10_000), holdings: [h(NVDA, "NVDA", 0, 100), h(TSLA, "TSLA", 0, 200)],
  targetsBps: { [NVDA.toLowerCase()]: 3000, [TSLA.toLowerCase()]: 3000 }, bandBps: 500, maxTradeBps: 2500, slippageBps: 100, ...over,
});

describe("Guardian Balanced strategy", () => {
  it("buys toward targets, each trade under the vault's per-trade limit", () => {
    const orders = plan(base());
    expect(orders).toHaveLength(2);
    for (const o of orders) {
      expect(o.side).toBe("buy");
      expect(o.amountIn <= u(10_000 * 0.25 * 0.95)).toBe(true);
      expect(o.minOut).toBeLessThan(o.expectedOut);
    }
  });

  it("does nothing inside the band", () => {
    expect(plan(base({ usdgBalance: u(4_000), holdings: [h(NVDA, "NVDA", 30, 100), h(TSLA, "TSLA", 15, 200)] }))).toHaveLength(0);
  });

  it("sells a token flagged high risk, even if it is on target", () => {
    const orders = plan(base({ usdgBalance: u(4_000), holdings: [h(NVDA, "NVDA", 30, 100), h(TSLA, "TSLA", 15, 200)], signals: { risk: { [TSLA.toLowerCase()]: "high" } } }));
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ side: "sell", symbol: "TSLA" });
    expect(orders[0]!.reason).toContain("risk");
  });

  it("does not add to a token trading at a premium above its exchange price", () => {
    const orders = plan(base({ signals: { premiumBps: { [NVDA.toLowerCase()]: 350 } } }));
    expect(orders.map((o) => o.symbol)).toEqual(["TSLA"]);
  });

  it("never spends more cash than it has", () => {
    const orders = plan(base({ usdgBalance: u(1_000), holdings: [h(NVDA, "NVDA", 45, 100), h(TSLA, "TSLA", 0, 200)] }));
    const spend = orders.filter((o) => o.side === "buy").reduce((a, o) => a + o.amountIn, 0n);
    const freed = orders.filter((o) => o.side === "sell").reduce((a, o) => a + o.minOut, 0n);
    expect(spend <= u(1_000) + freed).toBe(true);
  });
});
