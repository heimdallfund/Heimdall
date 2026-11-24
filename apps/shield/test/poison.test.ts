import { describe, it, expect } from "vitest";
import { encodeFunctionData, parseAbi, type Address, type PublicClient } from "viem";
import { lookalikeOf } from "../src/poison.js";
import { checkTransaction } from "../src/shield.js";

const REAL = "0xa1b2c3d4e5f60718293a4b5c6d7e8f9012345678" as Address;
/** An address that shares `head` first and `tail` last characters with REAL, and nothing in between. */
const like = (head: number, tail: number) => `0x${"a1b2c3d4e5f60718293a4b5c6d7e8f9012345678".slice(0, head)}${"e".repeat(40 - head - tail)}${tail ? "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678".slice(-tail) : ""}` as Address;
const POISON = like(5, 6);
const AGENT: Address = "0x1111111111111111111111111111111111111111";
const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

describe("address poisoning", () => {
  it("matches what a wallet shows: the first and last characters", () => {
    expect(lookalikeOf(POISON, [REAL])).toBe(REAL);
    expect(lookalikeOf(REAL, [REAL])).toBeUndefined();
    expect(lookalikeOf(like(3, 5), [REAL])).toBe(REAL);
    expect(lookalikeOf(like(4, 4), [REAL])).toBe(REAL);
    expect(lookalikeOf(like(2, 6), [REAL])).toBeUndefined(); // 2 at the start is chance
    expect(lookalikeOf(like(3, 2), [REAL])).toBeUndefined();
    expect(lookalikeOf(like(3, 4), [REAL])).toBeUndefined(); // 7 in total
    // vanity contracts share leading zeros on purpose
    expect(lookalikeOf("0x0000000000aaaaaaaaaaaaaaaaaaaaaaaaaaa8ba3", ["0x000000000022d473030f116ddee9f6b43ac78ba3"])).toBeUndefined();
  });

  it("denies a USDG transfer to a look-alike of an address the wallet paid before, and allows the real one", async () => {
    const client = {
      getCode: async ({ address }: { address: Address }) => (address.toLowerCase() === USDG.toLowerCase() ? "0x6080" : undefined),
      getBalance: async () => 10n ** 18n,
      readContract: async ({ functionName }: { functionName: string }) => (functionName === "symbol" ? "USDG" : functionName === "decimals" ? 6 : 10n ** 12n),
      request: async () => [{ calls: [{ status: "0x1", gasUsed: "0x1", logs: [] }] }],
    } as unknown as PublicClient;
    const send = (to: Address) => encodeFunctionData({ abi: parseAbi(["function transfer(address,uint256)"]), functionName: "transfer", args: [to, 1_000_000n] });
    const bad = await checkTransaction({ chainId: 4663, from: AGENT, to: USDG, data: send(POISON), value: 0n }, {}, { client, sign: false, history: [REAL.toLowerCase()] });
    expect(bad.verdict).toBe("DENY");
    expect(bad.findings.find((f) => f.code === "LOOKALIKE_ADDRESS")?.message).toContain("used before");
    const good = await checkTransaction({ chainId: 4663, from: AGENT, to: USDG, data: send(REAL), value: 0n }, {}, { client, sign: false, history: [REAL.toLowerCase()] });
    expect(good.findings.map((f) => f.code)).not.toContain("LOOKALIKE_ADDRESS");
  });
});
