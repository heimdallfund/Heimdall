import { describe, it, expect } from "vitest";
import { encodeAbiParameters, encodeFunctionData, parseAbi, type Address, type PublicClient } from "viem";
import { hookPermissions, assessHooks, DYNAMIC_FEE, UNIVERSAL_ROUTER } from "../src/v4hooks.js";
import { expandBatch } from "../src/decode.js";
import { checkTransaction } from "../src/shield.js";

// last 14 bits: 0x00C8 = beforeSwap (7) + afterSwap (6) + beforeSwapReturnsDelta (3); 0x0080 = beforeSwap only
const TAKER = "0x00000000000000000000000000000000000000C8";
const WATCHER = "0x0000000000000000000000000000000000000080";
const client = { getCode: async () => "0x6080", getBalance: async () => 0n, readContract: async () => 0n, request: async () => [{ calls: [{ status: "0x1", gasUsed: "0x1", logs: [] }] }] } as unknown as PublicClient;
const key = (hooks: string, fee = 3000) => ({ currency0: "0x0000000000000000000000000000000000000000", currency1: "0x4444444444444444444444444444444444444444", fee, tickSpacing: 60, hooks });

describe("Uniswap v4 hooks", () => {
  it("reads the permissions from the hook address", () => {
    expect(hookPermissions(TAKER)).toEqual(["beforeSwap", "afterSwap", "beforeSwapReturnsDelta"]);
    expect(hookPermissions("0x0000000000000000000000000000000000000000")).toEqual([]);
  });

  it("warns on a hook that can change swap amounts or set the fee, notes one that only watches", async () => {
    expect((await assessHooks(client, [key(TAKER)])).map((f) => [f.code, f.severity])).toEqual([["HOOK_TAKES_DELTA", "warn"]]);
    expect((await assessHooks(client, [key(WATCHER)])).map((f) => f.code)).toEqual(["HOOK_ON_SWAP"]);
    expect((await assessHooks(client, [key(WATCHER, DYNAMIC_FEE)])).map((f) => f.code)).toContain("HOOK_DYNAMIC_FEE");
    expect(await assessHooks(client, [key("0x0000000000000000000000000000000000000000")])).toEqual([]);
  });

  it("finds the pool inside a Universal Router V4_SWAP and flags its hook in a transaction check", async () => {
    const single = encodeAbiParameters(
      [{ type: "tuple", components: [{ name: "poolKey", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" }] }],
      [{ poolKey: key(TAKER) as never, zeroForOne: true, amountIn: 10n ** 15n, amountOutMinimum: 0n, hookData: "0x" }],
    );
    const v4input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x060c0f", [single, "0x", "0x"]]);
    const data = encodeFunctionData({ abi: parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline)"]), functionName: "execute", args: ["0x10", [v4input], 2_000_000_000n] });
    expect(expandBatch(UNIVERSAL_ROUTER, data).v4Pools[0]).toMatchObject({ fee: 3000, hooks: TAKER });
    const r = await checkTransaction({ chainId: 4663, from: "0x1111111111111111111111111111111111111111" as Address, to: UNIVERSAL_ROUTER, data, value: 10n ** 15n }, {}, { client, sign: false });
    expect(r.findings.map((f) => f.code)).toContain("HOOK_TAKES_DELTA");
  });
});
