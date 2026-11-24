import { describe, it, expect } from "vitest";
import { decodeFunctionData, pad, parseAbi, toHex, type Address, type Hex, type PublicClient } from "viem";
import { tokenCheck, SWAP_ROUTER_02 } from "../src/tokencheck.js";
import { UNIVERSAL_ROUTER, POOL_MANAGER } from "../src/v4hooks.js";
import { v4PoolsOf } from "../src/decode.js";
import { decodeAbiParameters } from "viem";

const TOKEN: Address = "0x4444444444444444444444444444444444444444";
const POOL: Address = "0x7777777777777777777777777777777777777777";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const topic = (a: Address) => pad(a, { size: 32 }).toLowerCase() as Hex;
const log = (from: Address, to: Address, amount: bigint) => ({ address: TOKEN, topics: [TRANSFER, topic(from), topic(to)] as Hex[], data: pad(toHex(amount), { size: 32 }) });
const ROUTER = parseAbi(["function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256)"]);
const X = parseAbi(["function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)", "function transferFrom(address,address,uint256) returns (bool)"]);

type Opts = { pool?: boolean; sell?: "ok" | "revert" | "tax"; buyTax?: number; pull?: boolean; symbol?: string };
function client(o: Opts = {}): PublicClient {
  return {
    getCode: async () => "0x6080",
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      if (functionName === "getPool") return o.pool === false ? "0x0000000000000000000000000000000000000000" : (args?.[2] === 3000 ? POOL : "0x0000000000000000000000000000000000000000");
      if (functionName === "liquidity") return 10n ** 20n;
      if (functionName === "getLiquidity") return 10n ** 20n;
      if (functionName === "symbol") return o.symbol ?? "MEME";
      if (functionName === "name") return "Meme";
      if (functionName === "decimals") return 18;
      if (functionName === "totalSupply") return 10n ** 27n;
      if (functionName === "owner") return "0x0000000000000000000000000000000000000000";
      throw new Error("unexpected " + functionName);
    },
    request: async ({ params }: { params: any }) => {
      const calls = params[0].blockStateCalls[0].calls as { from: Address; to: Address; data: Hex }[];
      return [{ calls: calls.map((c) => {
        const buyer = c.from;
        if (c.to.toLowerCase() === SWAP_ROUTER_02.toLowerCase()) {
          const p = decodeFunctionData({ abi: ROUTER, data: c.data }).args[0] as { tokenIn: Address; amountIn: bigint };
          if (p.tokenIn.toLowerCase() === TOKEN.toLowerCase()) { // sell
            if (o.sell === "revert") return { status: "0x0", returnData: "0x", error: { message: "TRANSFER_FROM_FAILED" }, logs: [] };
            const toPool = o.sell === "tax" ? (p.amountIn * 40n) / 100n : p.amountIn;
            return { status: "0x1", logs: [log(buyer, POOL, toPool)] };
          }
          const out = 1000n; // buy
          const kept = out - (out * BigInt(o.buyTax ?? 0)) / 100n;
          const TAXMAN: Address = "0x8888888888888888888888888888888888888888";
          return { status: "0x1", logs: [log(POOL, buyer, kept), ...(kept < out ? [log(POOL, TAXMAN, out - kept)] : [])] };
        }
        if (c.to.toLowerCase() === UNIVERSAL_ROUTER.toLowerCase()) {
          const ex = decodeFunctionData({ abi: parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline)"]), data: c.data });
          const input = (ex.args[1] as Hex[])[0]!;
          const [, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], input) as [Hex, Hex[]];
          const [st] = decodeAbiParameters([{ type: "tuple", components: [{ name: "k", type: "tuple", components: [{ name: "c0", type: "address" }, { name: "c1", type: "address" }, { name: "fee", type: "uint24" }, { name: "ts", type: "int24" }, { name: "h", type: "address" }] }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "min", type: "uint128" }, { name: "hd", type: "bytes" }] }], params[0]!) as unknown as [{ zeroForOne: boolean; amountIn: bigint }];
          if (st.zeroForOne) return { status: "0x1", logs: [log(POOL_MANAGER, c.from, 1000n)] }; // buy: ETH -> token
          if (o.sell === "revert") return { status: "0x0", returnData: "0x", error: { message: "SELL_BLOCKED" }, logs: [] };
          return { status: "0x1", logs: [log(c.from, POOL_MANAGER, st.amountIn)] };
        }
        if (c.to.toLowerCase() === "0x000000000022d473030f116ddee9f6b43ac78ba3") return { status: "0x1", logs: [] }; // Permit2.approve
        const d = decodeFunctionData({ abi: X, data: c.data });
        if (d.functionName === "approve") return { status: "0x1", logs: [] };
        if (d.functionName === "transfer") { const [to, amt] = d.args as [Address, bigint]; return { status: "0x1", logs: [log(c.from, to, amt)] }; }
        const [from, to, amt] = d.args as [Address, Address, bigint];
        return o.pull ? { status: "0x1", logs: [log(from, to, amt)] } : { status: "0x0", returnData: "0x", error: { message: "insufficient allowance" }, logs: [] };
      }) }];
    },
  } as unknown as PublicClient;
}

describe("Token Check", () => {
  it("falls back to a Uniswap v4 pool against ETH and catches a sell-blocking honeypot there", async () => {
    const id = ("0x" + "ab".repeat(32)) as Hex;
    const logs = { getBlockNumber: async () => 30_000_000n, getLogs: async ({ args }: { args: Record<string, string> }) => (args.currency1 ? [{ blockNumber: 5n, args: { id, currency0: "0x0000000000000000000000000000000000000000", currency1: args.currency1, fee: 3000, tickSpacing: 60, hooks: "0x0000000000000000000000000000000000000000" } }] : []) } as unknown as PublicClient;
    const ok = await tokenCheck(client({ pool: false, sell: "ok" }), TOKEN, Date.now(), logs);
    expect(ok.pool).toMatchObject({ version: 4, pair: "ETH", fee: 3000 });
    expect(ok.verdict).toBe("ALLOW");
    const hp = await tokenCheck(client({ pool: false, sell: "revert" }), TOKEN, Date.now(), { ...logs } as PublicClient);
    expect(hp.verdict).toBe("DENY");
    expect(hp.sell).toMatchObject({ ok: false, reason: "SELL_BLOCKED" });
  });

  it("passes a token that buys, sells and transfers without tax", async () => {
    const r = await tokenCheck(client({ sell: "ok" }), TOKEN);
    expect(r.verdict).toBe("ALLOW");
    expect(r.pool).toMatchObject({ address: POOL, fee: 3000, pair: "WETH" });
    expect([r.buy?.taxPct, r.sell?.taxPct, r.transfer?.taxPct]).toEqual([0, 0, 0]);
  });

  it("denies a honeypot: buying works, selling reverts", async () => {
    const r = await tokenCheck(client({ sell: "revert" }), TOKEN);
    expect(r.verdict).toBe("DENY");
    expect(r.sell).toMatchObject({ ok: false, reason: "TRANSFER_FROM_FAILED" });
    expect(r.findings.map((f) => f.code)).toContain("HONEYPOT");
  });

  it("measures buy and sell taxes from the transfers", async () => {
    const r = await tokenCheck(client({ sell: "tax", buyTax: 12 }), TOKEN);
    expect(r.buy?.taxPct).toBe(12);
    expect(r.sell?.taxPct).toBe(60);
    expect(r.findings.find((f) => f.code === "SELL_TAX")?.severity).toBe("deny");
    expect(r.findings.find((f) => f.code === "BUY_TAX")?.severity).toBe("warn");
  });

  it("denies a token anyone can pull from a holder, and a fake ticker", async () => {
    expect((await tokenCheck(client({ sell: "ok", pull: true }), TOKEN)).pullableBy).toEqual(["anyone"]);
    const fake = await tokenCheck(client({ sell: "ok", symbol: "USDG" }), TOKEN);
    expect(fake.verdict).toBe("DENY");
    expect(fake.findings.map((f) => f.code)).toContain("FAKE_TOKEN");
  });

  it("warns when there is no v3 pool and no v4 pool to simulate against", async () => {
    const noLogs = { getBlockNumber: async () => 30_000_000n, getLogs: async () => [] } as unknown as PublicClient;
    const r = await tokenCheck(client({ pool: false }), TOKEN, Date.now(), noLogs);
    expect(r.verdict).toBe("WARN");
    expect(r.findings.map((f) => f.code)).toContain("NO_POOL");
  });
});
