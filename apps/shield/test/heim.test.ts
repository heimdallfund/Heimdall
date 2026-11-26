import { describe, expect, it } from "vitest";
import { heimToken, HEIM_DEV } from "../src/heim.js";
import { MemoryStore } from "../src/store.js";

const LAUNCHED = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
const word = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
const COPY = "0x00000000000000000000000000000000000000c0", REAL = "0x00000000000000000000000000000000000000a1";
const fake = (tokens: Record<string, { deployer: string; symbol: string }>) => {
  const launches = Object.keys(tokens).map((t) => ({ topics: [LAUNCHED, word(t), word("0x0000000000000000000000000000000000000c00"), word(HEIM_DEV)] }));
  let reads = 0;
  const logs = { getBlockNumber: async () => 20_000_000n, request: async () => launches } as never;
  const client = { readContract: async ({ address, functionName }: { address: string; functionName: "deployer" | "symbol" }) => { reads++; return tokens[address.toLowerCase()]![functionName]; } } as never;
  return { logs, client, reads: () => reads };
};

describe("$HEIM auto-detection", () => {
  it("takes only a HEIM token deployed by the dev wallet, keeps it, and prefers the env address", async () => {
    const s = new MemoryStore();
    const f = fake({ [COPY]: { deployer: HEIM_DEV, symbol: "NOTHEIM" }, [REAL]: { deployer: HEIM_DEV, symbol: "HEIM" } });
    expect((await heimToken(s, f.client, f.logs))?.toLowerCase()).toBe(REAL);
    const before = f.reads();
    expect((await heimToken(s, f.client, f.logs))?.toLowerCase()).toBe(REAL); // kept: no new chain reads
    expect(f.reads()).toBe(before);
    expect((await heimToken(new MemoryStore(), f.client, f.logs, "0x00000000000000000000000000000000000000E1"))?.toLowerCase()).toBe("0x00000000000000000000000000000000000000e1");
  });
  it("finds nothing before launch, and looks again at most once a minute", async () => {
    const s = new MemoryStore();
    const f = fake({ [COPY]: { deployer: "0x0000000000000000000000000000000000000bad", symbol: "HEIM" } }); // copycat deployer
    expect(await heimToken(s, f.client, f.logs)).toBeNull();
    const n = f.reads();
    expect(await heimToken(s, f.client, f.logs)).toBeNull();
    expect(f.reads()).toBe(n);
  });
});

describe("relaunch", () => {
  it("skips the retired first $HEIM and takes the newest launch", async () => {
    const OLD = "0x6e446368fd41f18edb48a8a55766802e0713bcbc", NEW = "0x00000000000000000000000000000000000000b2";
    const f = fake({ [OLD]: { deployer: HEIM_DEV, symbol: "HEIM" }, [NEW]: { deployer: HEIM_DEV, symbol: "HEIM" } });
    expect((await heimToken(new MemoryStore(), f.client, f.logs))?.toLowerCase()).toBe(NEW);
    const g = fake({ [OLD]: { deployer: HEIM_DEV, symbol: "HEIM" } });
    expect(await heimToken(new MemoryStore(), g.client, g.logs)).toBeNull();
  });
});
