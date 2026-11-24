import { describe, expect, it } from "vitest";
import { pad, type Hex, type PublicClient } from "viem";
import { buildRadar, runChecks } from "../src/radar.js";
import type { TokenCheck } from "../src/tokencheck.js";

const PONS_LAUNCH = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CURVE_A = "0xcccccccccccccccccccccccccccccccccccccccc";
const CURVE_B = "0xdddddddddddddddddddddddddddddddddddddddd";
const DEV = "0x1111111111111111111111111111111111111111";
const w = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const t = (a: string) => pad(a as Hex).toLowerCase();
const tr = (token: string, from: string, to: string) => ({ address: token, topics: [TRANSFER, t(from), t(to)], data: "0x01", blockNumber: "0x64" });

function mockLogs(): PublicClient {
  return {
    getBlockNumber: async () => 1_000_000n,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber / 10n }), // 10 blocks a second
    getLogs: async () => [],
    request: async ({ params }: { params: [{ topics: string[]; address?: string | string[] }] }) => {
      const f = params[0];
      if (f.topics[0] === PONS_LAUNCH) return [
        { topics: [PONS_LAUNCH, t(TOKEN_A), t(CURVE_A), t(DEV)], blockNumber: "0xf0000" },
        { topics: [PONS_LAUNCH, t(TOKEN_B), t(CURVE_B), t(DEV)], blockNumber: "0xf4240" },
      ];
      if (f.topics[0] === TRANSFER) return [
        // A: three different buyers and one sell; B: one buyer buying twice
        tr(TOKEN_A, CURVE_A, w(1)), tr(TOKEN_A, CURVE_A, w(2)), tr(TOKEN_A, CURVE_A, w(3)), tr(TOKEN_A, w(1), CURVE_A),
        tr(TOKEN_B, CURVE_B, w(9)), tr(TOKEN_B, CURVE_B, w(9)),
        tr(TOKEN_A, w(2), w(4)), // a wallet-to-wallet move is neither
      ];
      return [];
    },
  } as unknown as PublicClient;
}

describe("Launch Radar", () => {
  it("ranks launches by distinct buyers in the last hour and reuses fresh checks", async () => {
    const checked: string[] = [];
    const snap = await buildRadar({
      client: { multicall: async () => [] } as unknown as PublicClient, logs: mockLogs(), now: 1_000_000,
      check: async (token) => { checked.push(token); return { verdict: "ALLOW", riskScore: 0, findings: [], checkedAt: 1, launch: null, holders: null } as unknown as TokenCheck; },
      getCheck: async (token) => (token.toLowerCase() === TOKEN_B ? { verdict: "DENY", riskScore: 95, flags: ["HONEYPOT"], holders: 2, top10Pct: 100, devSoldPct: null, progressPct: 3, checkedAt: 1 } : null),
      putCheck: async () => {}, minLaunches: 0,
    });
    expect(snap.tokens[0]!.check).toBeNull();
    expect(await runChecks(snap, { check: async (token) => { checked.push(token); return { verdict: "ALLOW", riskScore: 0, findings: [], checkedAt: 1, launch: null, holders: null } as unknown as TokenCheck; }, putCheck: async () => {} })).toBe(1);
    expect(snap.tokens[0]!.check?.verdict).toBe("ALLOW");
    expect(snap.launched24h).toBe(2);
    expect(snap.tokens.map((x) => x.token.toLowerCase())).toEqual([TOKEN_A, TOKEN_B]);
    expect(snap.tokens[0]).toMatchObject({ venue: "Pons", buyers1h: 3, buys1h: 3, sells1h: 1 });
    expect(snap.tokens[1]).toMatchObject({ buyers1h: 1, buys1h: 2, sells1h: 0 });
    expect(snap.tokens[1]!.check?.flags).toEqual(["HONEYPOT"]);
    expect(checked.map((x) => x.toLowerCase())).toEqual([TOKEN_A]); // B's verdict came from the cache
  });
});
