import { describe, expect, it, afterEach } from "vitest";
import { encodeAbiParameters, encodeFunctionData, pad, parseAbi, toHex, type Address, type Hex, type PublicClient } from "viem";
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

function client(opts: { probe?: "ok" | "tax" | "revert" } = {}): PublicClient {
  const contracts = new Set([TOKEN, ROUTER, PERMIT2].map((a) => a.toLowerCase()));
  return {
    getCode: async ({ address }: { address: Address }) => (contracts.has(address.toLowerCase()) ? "0x6080" : undefined),
    getBalance: async () => 10n ** 18n,
    readContract: async ({ functionName }: { functionName: string }) => (functionName === "symbol" ? "MEME" : functionName === "decimals" ? 18 : 10n ** 30n),
    request: async ({ params }: { params: any }) => {
      const calls = params[0].blockStateCalls[0].calls;
      const main = { status: "0x1", gasUsed: "0x1", logs: [log(TOKEN, ROUTER, AGENT, 1000n)] };
      if (calls.length === 1) return [{ calls: [main] }];
      const probe = opts.probe === "revert"
        ? { status: "0x0", returnData: "0x", error: { message: "trading not enabled" }, logs: [] }
        : { status: "0x1", gasUsed: "0x1", logs: [log(TOKEN, AGENT, PROBE, opts.probe === "tax" ? 880n : 1000n)] };
      return [{ calls: [main, probe] }];
    },
  } as unknown as PublicClient;
}

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
});
