import { describe, expect, it } from "vitest";
import { getAddress, type PublicClient } from "viem";
import { explorerHoldings, flagHoldings, type Holding } from "../src/holdings.js";

const NVDA_REAL = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";
const FAKE = getAddress("0x1111111111111111111111111111111111111111");
const TRAP = getAddress("0x2222222222222222222222222222222222222222");
const PLAIN = getAddress("0x3333333333333333333333333333333333333333");
const DRAINER = getAddress("0x281FF81dF0Eca1F3F7Ba2A48499c7A83D216a2A8");

const sym: Record<string, string> = { [FAKE.toLowerCase()]: "NVDA", [TRAP.toLowerCase()]: "MOON", [PLAIN.toLowerCase()]: "PLAIN", [DRAINER.toLowerCase()]: "X" };
const client = {
  readContract: async ({ address, functionName }: { address: string; functionName: "symbol" | "name" }) => {
    const s = sym[address.toLowerCase()] ?? "T";
    return functionName === "symbol" ? s : `${s} token`;
  },
} as unknown as PublicClient;

const h = (token: string, symbol: string): Holding => ({ token: getAddress(token), symbol, name: null, decimals: 18, value: 10n ** 18n });

describe("held token flags", () => {
  it("flags fakes, blocklisted tokens and Token Check traps, and stays quiet on the rest", async () => {
    const check = async (t: string) => ({
      findings: t.toLowerCase() === TRAP.toLowerCase()
        ? [{ code: "HONEYPOT", severity: "deny" as const, message: "Buying works but selling fails." }]
        : [{ code: "NO_POOL", severity: "warn" as const, message: "No pool." }],
    }) as never;
    const flags = await flagHoldings(client, [h(NVDA_REAL, "NVDA"), h(FAKE, "NVDA"), h(TRAP, "MOON"), h(PLAIN, "PLAIN"), h(DRAINER, "X")], { check });
    const codes = Object.fromEntries(flags.map((f) => [f.symbol, f.code]));
    expect(codes).toEqual({ NVDA: "FAKE_TOKEN", MOON: "HONEYPOT", X: "BLOCKLISTED_TOKEN" });
    expect(flags.every((f) => f.risk === "danger")).toBe(true);
    expect(flags.find((f) => f.code === "FAKE_TOKEN")!.balance).toBe("1");
  });

  it("caps the full checks and survives a slow or failing check", async () => {
    let calls = 0;
    const slow = async () => { calls++; await new Promise((r) => setTimeout(r, 200)); return null; };
    const many = Array.from({ length: 9 }, (_, i) => h(`0x${(0x40 + i).toString(16).padStart(40, "0")}`, `T${i}`));
    const flags = await flagHoldings(client, many, { check: slow, deepLimit: 3, timeoutMs: 50 });
    expect(flags).toEqual([]);
    expect(calls).toBe(3);
  });

  it("reads explorer balances and skips empty and non-ERC-20 entries", async () => {
    const body = [
      { value: "5000000", token: { address_hash: FAKE, type: "ERC-20", symbol: "NVDA", decimals: "6" } },
      { value: "0", token: { address_hash: TRAP, type: "ERC-20", symbol: "MOON", decimals: "18" } },
      { value: "1", token: { address_hash: PLAIN, type: "ERC-721", symbol: "NFT" } },
    ];
    const fetcher = (async () => new Response(JSON.stringify(body))) as typeof fetch;
    const r = await explorerHoldings(PLAIN, fetcher, {});
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ token: FAKE, symbol: "NVDA", decimals: 6, value: 5_000_000n });
    expect(await explorerHoldings(PLAIN, (async () => { throw new Error("down"); }) as typeof fetch, {})).toEqual([]);
  });
});
