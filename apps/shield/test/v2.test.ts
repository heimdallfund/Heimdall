import { describe, expect, it, afterEach } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, pad, parseAbi, toHex, type Address, type Hex, type PublicClient } from "viem";
import { checkPersonalMessage, checkTypedData } from "../src/typed.js";
import { checkTransaction } from "../src/shield.js";
import { PolicySchema } from "../src/policy.js";
import { resetBlocklist } from "../src/blocklist.js";
import { PROBE } from "../src/simulate.js";

const AGENT: Address = "0x1111111111111111111111111111111111111111";
const TOKEN: Address = "0x4444444444444444444444444444444444444444"; // unknown token (contract)
const ROUTER: Address = "0x2222222222222222222222222222222222222222"; // contract
const DRAINER: Address = "0x3333333333333333333333333333333333333333"; // EOA
const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const policy = PolicySchema.parse({});
const MAX160 = (1n << 160n) - 1n;

const topic = (a: Address) => pad(a, { size: 32 }).toLowerCase() as Hex;
const log = (token: Address, from: Address, to: Address, amount: bigint) => ({ address: token, topics: [TRANSFER, topic(from), topic(to)] as Hex[], data: pad(toHex(amount), { size: 32 }) });

function client(opts: { probe?: "ok" | "tax" | "revert"; sellBlocked?: boolean; backdoor?: "anyone" | "owner"; vanish?: boolean; symbol?: string } = {}): PublicClient {
  const contracts = new Set([TOKEN, ROUTER, PERMIT2].map((a) => a.toLowerCase()));
  const OWNER: Address = "0x9999999999999999999999999999999999999999";
  const X = parseAbi(["function transfer(address,uint256) returns (bool)", "function transferFrom(address,address,uint256) returns (bool)"]);
  return {
    getCode: async ({ address }: { address: Address }) => (contracts.has(address.toLowerCase()) ? "0x6080" : undefined),
    getBalance: async () => 10n ** 18n,
    readContract: async ({ functionName }: { functionName: string }) => (functionName === "symbol" ? (opts.symbol ?? "MEME") : functionName === "name" ? "Meme" : functionName === "decimals" ? 18 : functionName === "owner" ? (opts.backdoor === "owner" ? OWNER : "0x0000000000000000000000000000000000000000") : 10n ** 30n),
    request: async ({ params }: { params: any }) => {
      const calls = params[0].blockStateCalls[0].calls;
      const mainLogs = [log(TOKEN, ROUTER, AGENT, 1000n), ...(opts.vanish ? [log(USDG_, AGENT, ROUTER, 500n), log(TOKEN, AGENT, OWNER, 1000n)] : [])];
      const main = { status: "0x1", gasUsed: "0x1", logs: mainLogs };
      if (calls.length === 1) return [{ calls: [main] }];
      const c = calls[1];
      const revert = (message: string) => ({ status: "0x0", returnData: "0x", error: { message }, logs: [] });
      let probe;
      try {
        const d = decodeFunctionData({ abi: X, data: c.data });
        if (d.functionName === "transfer") {
          const [to, amount] = d.args as [Address, bigint];
          if (opts.probe === "revert") probe = revert("trading not enabled");
          else if (opts.sellBlocked && to.toLowerCase() === ROUTER.toLowerCase()) probe = revert("sell not allowed");
          else probe = { status: "0x1", gasUsed: "0x1", logs: [log(TOKEN, AGENT, to, opts.probe === "tax" ? (amount * 88n) / 100n : amount)] };
        } else {
          const [from, to, amount] = d.args as [Address, Address, bigint];
          const can = (opts.backdoor === "anyone") || (opts.backdoor === "owner" && c.from.toLowerCase() === OWNER.toLowerCase());
          probe = can ? { status: "0x1", gasUsed: "0x1", logs: [log(TOKEN, from, to, amount)] } : revert("ERC20: insufficient allowance");
        }
      } catch { probe = revert("unknown"); }
      return [{ calls: [main, probe] }];
    },
  } as unknown as PublicClient;
}
const USDG_: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

describe("Signature checks (offchain)", () => {
  it("denies an EIP-2612 permit to a plain wallet", async () => {
    const r = await checkTypedData(4663, AGENT, {
      domain: { name: "USDG", version: "1", chainId: 4663, verifyingContract: TOKEN },
      primaryType: "Permit", message: { owner: AGENT, spender: DRAINER, value: "1000", nonce: 0, deadline: 9_999_999_999 },
    }, policy, client());
    expect(r.verdict).toBe("DENY");
    expect(r.findings.map((f) => f.code)).toContain("PERMIT_TO_EOA");
  });

  it("warns on an unlimited Permit2 PermitSingle to a contract", async () => {
    const r = await checkTypedData(4663, AGENT, {
      domain: { name: "Permit2", chainId: 4663, verifyingContract: PERMIT2 },
      primaryType: "PermitSingle",
      message: { details: { token: TOKEN, amount: MAX160.toString(), expiration: 2_000_000_000, nonce: 0 }, spender: ROUTER, sigDeadline: 2_000_000_000 },
    }, policy, client(), 1_800_000_000);
    expect(r.verdict).toBe("WARN");
    expect(r.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["PERMIT_UNLIMITED", "PERMIT_LONG_EXPIRY"]));
  });

  it("denies a signature for another chain and an order that pays nothing", async () => {
    const wrong = await checkTypedData(4663, AGENT, { domain: { chainId: 1, verifyingContract: TOKEN }, primaryType: "Permit", message: { owner: AGENT, spender: ROUTER, value: "1", deadline: 1 } }, policy, client());
    expect(wrong.findings.map((f) => f.code)).toContain("WRONG_CHAIN");
    const order = await checkTypedData(4663, AGENT, { domain: { chainId: 4663 }, primaryType: "OrderComponents", message: { offerer: AGENT, offer: [{}], consideration: [{ recipient: DRAINER, startAmount: "1" }] } }, policy, client());
    expect(order.verdict).toBe("DENY");
  });

  it("denies blind signing of a 32-byte hash", () => {
    expect(checkPersonalMessage(`0x${"ab".repeat(32)}`, policy).verdict).toBe("DENY");
    expect(checkPersonalMessage("Sign in to Heimdall", policy).verdict).toBe("ALLOW");
  });
});

describe("Batched calls", () => {
  it("finds a Permit2 permit to a drainer inside Universal Router execute()", async () => {
    const permitInput = encodeAbiParameters(
      [{ type: "tuple", components: [{ name: "details", type: "tuple", components: [{ name: "token", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }] }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }] }, { type: "bytes" }],
      [{ details: { token: TOKEN, amount: MAX160, expiration: 2_000_000_000, nonce: 0 }, spender: DRAINER, sigDeadline: 2_000_000_000n }, "0x"],
    );
    const data = encodeFunctionData({ abi: parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline)"]), functionName: "execute", args: ["0x0a", [permitInput], 2_000_000_000n] });
    const r = await checkTransaction({ chainId: 4663, from: AGENT, to: ROUTER, data, value: 0n }, {}, { client: client(), sign: false });
    expect(r.verdict).toBe("DENY");
    expect(r.summary.join(" ")).toContain("Permit2 permit");
  });
});

describe("Received-token checks", () => {
  it("denies a honeypot the agent cannot move", async () => {
    const r = await checkTransaction({ chainId: 4663, from: AGENT, to: ROUTER, data: "0xdeadbeef", value: 0n }, {}, { client: client({ probe: "revert" }), sign: false });
    expect(r.findings.map((f) => f.code)).toContain("HONEYPOT");
    expect(r.verdict).toBe("DENY");
  });

  it("flags a transfer tax", async () => {
    const r = await checkTransaction({ chainId: 4663, from: AGENT, to: ROUTER, data: "0xdeadbeef", value: 0n }, {}, { client: client({ probe: "tax" }), sign: false });
    const tax = r.findings.find((f) => f.code === "TRANSFER_TAX");
    expect(tax?.severity).toBe("warn");
    expect(tax?.message).toContain("12.0%");
  });

  it("denies a token that moves but cannot be sold back to its pool", async () => {
    const r = await checkTransaction({ chainId: 4663, from: AGENT, to: ROUTER, data: "0xdeadbeef", value: 0n }, {}, { client: client({ probe: "ok", sellBlocked: true }), sign: false });
    expect(r.verdict).toBe("DENY");
    expect(r.findings.find((f) => f.code === "HONEYPOT")?.message).toContain("not sold back");
  });

  it("denies a token anyone, or its owner, can pull out of the wallet without an approval", async () => {
    for (const backdoor of ["anyone", "owner"] as const) {
      const r = await checkTransaction({ chainId: 4663, from: AGENT, to: ROUTER, data: "0xdeadbeef", value: 0n }, {}, { client: client({ probe: "ok", backdoor }), sign: false });
      expect(r.verdict).toBe("DENY");
      expect(r.findings.find((f) => f.code === "ALLOWANCE_BYPASS")?.message).toContain(backdoor === "anyone" ? "lets anyone" : "its owner 0x9999");
    }
  });

  it("denies the vanishing-token scam: you pay, the token arrives and is taken back in the same transaction", async () => {
    const r = await checkTransaction({ chainId: 4663, from: AGENT, to: ROUTER, data: "0xdeadbeef", value: 0n }, {}, { client: client({ probe: "ok", vanish: true }), sign: false });
    expect(r.verdict).toBe("DENY");
    expect(r.findings.map((f) => f.code)).toContain("VANISHING_TOKEN");
  });

  it("denies receiving a fake NVDA: the real ticker at the wrong address", async () => {
    const r = await checkTransaction({ chainId: 4663, from: AGENT, to: ROUTER, data: "0xdeadbeef", value: 0n }, {}, { client: client({ probe: "ok", symbol: "NVDА" }), sign: false });
    expect(r.verdict).toBe("DENY");
    expect(r.findings.find((f) => f.code === "FAKE_TOKEN")?.message).toContain("the real NVDA is 0xd060");
  });

  it("passes a normal token", async () => {
    const r = await checkTransaction({ chainId: 4663, from: AGENT, to: ROUTER, data: "0xdeadbeef", value: 0n }, {}, { client: client({ probe: "ok" }), sign: false });
    expect(r.verdict).toBe("ALLOW");
  });
});

describe("Blocklist", () => {
  afterEach(() => { delete process.env.SHIELD_BLOCKLIST; resetBlocklist(); });
  it("denies calls to a blocklisted target", async () => {
    process.env.SHIELD_BLOCKLIST = ROUTER;
    resetBlocklist();
    const r = await checkTransaction({ chainId: 4663, from: AGENT, to: ROUTER, data: "0xdeadbeef", value: 0n }, {}, { client: client({ probe: "ok" }), sign: false });
    expect(r.findings.map((f) => f.code)).toContain("BLOCKLISTED_TARGET");
  });

  it("denies buying a token that is itself on the blocklist", async () => {
    process.env.SHIELD_BLOCKLIST = TOKEN;
    resetBlocklist();
    const r = await checkTransaction({ chainId: 4663, from: AGENT, to: ROUTER, data: "0xdeadbeef", value: 0n }, {}, { client: client({ probe: "ok" }), sign: false });
    expect(r.verdict).toBe("DENY");
    expect(r.findings.map((f) => f.code)).toContain("BLOCKLISTED_TOKEN");
  });
});
