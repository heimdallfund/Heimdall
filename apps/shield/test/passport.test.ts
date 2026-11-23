import { describe, expect, it } from "vitest";
import { feedbackFile, feedbackHash, readRegistration, scorePassport } from "../src/passport.js";

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 23);
const shield = (checks: number, denied = 0, warned = 0, days = 60) => ({ checks, allowed: checks - denied - warned, warned, denied, firstSeen: now - days * DAY });

describe("Heimdall Score", () => {
  it("rewards a clean Shield record and a reliable Pay record", () => {
    const s = scorePassport({ shield: shield(200, 0, 2, 120), pay: { completed: 40, disputed: 0, earnedUsdg: 900 }, riskLevel: 0, txCount: 800, now });
    expect(s.tier).toBe("A");
    expect(s.score).toBeGreaterThanOrEqual(95);
    expect(s.components.map((c) => c.name)).toEqual(["shield", "pay", "history"]);
  });

  it("punishes denied transactions and disputed jobs", () => {
    const s = scorePassport({ shield: shield(100, 20, 10), pay: { completed: 10, disputed: 10, earnedUsdg: 50 }, riskLevel: 0, txCount: 100, now });
    expect(s.score!).toBeLessThan(50);
    expect(s.tier).toBe("D");
  });

  it("a single Pay job barely moves the score (confidence grows with volume)", () => {
    const one = scorePassport({ shield: shield(0), pay: { completed: 1, disputed: 0, earnedUsdg: 5 }, riskLevel: 0, txCount: 0, now });
    const twenty = scorePassport({ shield: shield(0), pay: { completed: 20, disputed: 0, earnedUsdg: 500 }, riskLevel: 0, txCount: 0, now });
    expect(one.components.find((c) => c.name === "pay")!.score).toBeLessThan(55);
    expect(twenty.components.find((c) => c.name === "pay")!.score).toBe(100);
  });

  it("history alone is not enough: new agents are 'new', not scored", () => {
    const s = scorePassport({ shield: shield(2, 0, 0, 1), pay: null, riskLevel: 0, txCount: 5000, now });
    expect(s.score).toBeNull();
    expect(s.tier).toBe("new");
  });

  it("blocked addresses score 0, flagged ones are capped at 40", () => {
    const good = { shield: shield(200), pay: { completed: 40, disputed: 0, earnedUsdg: 1 }, txCount: 500, now };
    expect(scorePassport({ ...good, riskLevel: 3 })).toMatchObject({ score: 0, tier: "blocked" });
    expect(scorePassport({ ...good, riskLevel: 2 })).toMatchObject({ score: 40, tier: "D" });
  });

  it("is deterministic", () => {
    const i = { shield: shield(57, 3, 4, 33), pay: { completed: 7, disputed: 1, earnedUsdg: 70 }, riskLevel: 0, txCount: 41, now };
    expect(scorePassport(i)).toEqual(scorePassport(i));
  });
});

describe("ERC-8004 registration files and feedback", () => {
  it("reads data: URIs and drops unexpected fields", async () => {
    const json = { type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1", name: "Momentum agent", description: "Trades NVDA", services: [{ name: "MCP", endpoint: "https://x.example/mcp", version: "2025-06-18" }], x402Support: true, active: true, evil: "<script>" };
    const r = await readRegistration(`data:application/json;base64,${Buffer.from(JSON.stringify(json)).toString("base64")}`);
    expect(r).toEqual({ name: "Momentum agent", description: "Trades NVDA", image: undefined, services: [{ name: "MCP", endpoint: "https://x.example/mcp", version: "2025-06-18" }], x402Support: true, active: true });
  });

  it("refuses non-https, oversized and broken files", async () => {
    expect(await readRegistration("http://insecure.example/agent.json")).toBeNull();
    const big = (async () => new Response("x".repeat(70_000), { status: 200 })) as unknown as typeof fetch;
    expect(await readRegistration("https://big.example/a.json", big)).toBeNull();
    const broken = (async () => new Response("{not json", { status: 200 })) as unknown as typeof fetch;
    expect(await readRegistration("https://broken.example/a.json", broken)).toBeNull();
  });

  it("builds the off-chain feedback file the spec asks for, with a stable hash", () => {
    const f = feedbackFile({ agentId: "7", publisher: "0x00000000000000000000000000000000000000aa", chainId: 4663, score: 88, tier: "A", address: "0x00000000000000000000000000000000000000bb", components: [], at: now });
    expect(f).toMatchObject({ agentRegistry: "eip155:4663:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", agentId: 7, clientAddress: "eip155:4663:0x00000000000000000000000000000000000000aa", value: 88, valueDecimals: 0, tag1: "heimdall", tag2: "A" });
    expect(feedbackHash(f)).toBe(feedbackHash(JSON.parse(JSON.stringify(f))));
  });
});
