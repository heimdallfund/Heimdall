import { describe, expect, it } from "vitest";
import {
  type Address, type Hex, type PublicClient,
  encodeFunctionData, maxUint256, pad, parseAbi, toHex, verifyTypedData, zeroAddress, keccak256,
} from "viem";
import { checkTransaction } from "../src/shield.js";
import { parseLogs } from "../src/simulate.js";
import { NATIVE_ASSET } from "../src/chains.js";
import { receiptDomain, RECEIPT_TYPES } from "../src/receipt.js";
import { buildApp } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

const ERC20 = parseAbi([
  "function approve(address,uint256)",
  "function transfer(address,uint256)",
  "function setApprovalForAll(address,bool)",
]);
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const AGENT: Address = "0x1111111111111111111111111111111111111111";
const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const WETH: Address = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const ROUTER: Address = "0x2222222222222222222222222222222222222222"; // contract
const ATTACKER: Address = "0x3333333333333333333333333333333333333333"; // EOA

const topic = (a: Address) => pad(a, { size: 32 }).toLowerCase() as Hex;
const transferLog = (token: Address, from: Address, to: Address, amount: bigint) => ({
  address: token, topics: [TRANSFER, topic(from), topic(to)] as Hex[], data: pad(toHex(amount), { size: 32 }),
});

interface Mock {
  contracts?: Address[];
  status?: "0x1" | "0x0";
  logs?: ReturnType<typeof transferLog>[];
  balances?: Record<string, bigint>;
  simFails?: boolean;
  revertData?: Hex;
}

function mockClient(m: Mock = {}): PublicClient {
  const contracts = new Set([USDG, WETH, ROUTER, ...(m.contracts ?? [])].map((a) => a.toLowerCase()));
  const meta: Record<string, { symbol: string; decimals: number }> = {
    [USDG.toLowerCase()]: { symbol: "USDG", decimals: 6 },
    [WETH.toLowerCase()]: { symbol: "WETH", decimals: 18 },
  };
  return {
    getCode: async ({ address }: { address: Address }) => (contracts.has(address.toLowerCase()) ? "0x6080" : undefined),
    getBalance: async () => m.balances?.native ?? 10n ** 18n,
    readContract: async ({ address, functionName }: { address: Address; functionName: string }) => {
      const t = meta[address.toLowerCase()];
      if (functionName === "symbol") { if (!t) throw new Error("no"); return t.symbol; }
      if (functionName === "decimals") { if (!t) throw new Error("no"); return t.decimals; }
      if (functionName === "balanceOf") return m.balances?.[address.toLowerCase()] ?? 10n ** 30n;
      throw new Error("unexpected");
    },
    request: async ({ method }: { method: string }) => {
      if (method !== "eth_simulateV1") throw new Error("unexpected method");
      if (m.simFails) throw new Error("method not supported");
      return [{ calls: [{ status: m.status ?? "0x1", gasUsed: "0x5208", returnData: m.revertData ?? "0x", logs: m.logs ?? [], error: m.status === "0x0" ? { message: "execution reverted", data: m.revertData } : undefined }] }];
    },
  } as unknown as PublicClient;
}

const tx = (to: Address | null, data: Hex = "0x", value = 0n) => ({ chainId: 4663, from: AGENT, to, data, value });

describe("Heimdall Shield", () => {
  it("looks up a known contract once per client, but re-checks wallets every time", async () => {
    const client = mockClient();
    let calls = 0;
    const inner = client.getCode;
    (client as unknown as { getCode: typeof inner }).getCode = (async (a: { address: Address }) => { calls++; return inner(a as never); }) as typeof inner;
    const toRouter = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, 1000n] });
    await checkTransaction(tx(USDG, toRouter), {}, { client, sign: false });
    const first = calls;
    await checkTransaction(tx(USDG, toRouter), {}, { client, sign: false });
    expect(calls).toBe(first); // USDG and the router are cached
    const toWallet = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ATTACKER, 1000n] });
    await checkTransaction(tx(USDG, toWallet), {}, { client, sign: false });
    await checkTransaction(tx(USDG, toWallet), {}, { client, sign: false });
    expect(calls).toBe(first + 2); // the wallet is looked up both times
  });

  it("denies unlimited approval to a plain wallet (drainer pattern)", async () => {
    const data = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ATTACKER, maxUint256] });
    const r = await checkTransaction(tx(USDG, data), {}, { client: mockClient(), sign: false });
    expect(r.verdict).toBe("DENY");
    expect(r.findings.map((f) => f.code)).toContain("UNLIMITED_APPROVAL_TO_EOA");
  });

  it("warns on unlimited approval to an unknown contract, allows when trusted", async () => {
    const data = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, maxUint256] });
    const warn = await checkTransaction(tx(USDG, data), {}, { client: mockClient(), sign: false });
    expect(warn.verdict).toBe("WARN");
    const ok = await checkTransaction(tx(USDG, data), { trustedSpenders: [ROUTER] }, { client: mockClient(), sign: false });
    expect(ok.verdict).toBe("ALLOW");
  });

  it("denies when the policy forbids unlimited approvals", async () => {
    const data = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, maxUint256] });
    const r = await checkTransaction(tx(USDG, data), { trustedSpenders: [ROUTER], denyUnlimitedApprovals: true }, { client: mockClient(), sign: false });
    expect(r.verdict).toBe("DENY");
  });

  it("denies transactions that would revert and decodes the reason", async () => {
    const revertData = encodeFunctionData({ abi: parseAbi(["function Error(string)"]), functionName: "Error", args: ["insufficient balance"] });
    const r = await checkTransaction(tx(ROUTER, "0x12345678"), {}, { client: mockClient({ status: "0x0", revertData }), sign: false });
    expect(r.verdict).toBe("DENY");
    expect(r.simulation.revertReason).toBe("insufficient balance");
  });

  it("allows a normal swap (USDG out, WETH in)", async () => {
    const logs = [transferLog(USDG, AGENT, ROUTER, 100_000_000n), transferLog(WETH, ROUTER, AGENT, 3n * 10n ** 16n)];
    const r = await checkTransaction(tx(ROUTER, "0xdeadbeef"), {}, { client: mockClient({ logs }), sign: false });
    expect(r.verdict).toBe("ALLOW");
    expect(r.summary).toContain("Sends 100 USDG");
    expect(r.summary).toContain("Receives 0.03 WETH");
  });

  it("flags a one-way drain of the whole balance; strict mode denies", async () => {
    const data = encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [ATTACKER, 500n] });
    const logs = [transferLog(USDG, AGENT, ATTACKER, 500n)];
    const client = mockClient({ logs, balances: { [USDG.toLowerCase()]: 500n } });
    const r = await checkTransaction(tx(USDG, data), {}, { client, sign: false });
    expect(r.verdict).toBe("WARN");
    expect(r.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["ONE_WAY_OUTFLOW", "DRAINS_BALANCE"]));
    const strict = await checkTransaction(tx(USDG, data), { strict: true }, { client, sign: false });
    expect(strict.verdict).toBe("DENY");
  });

  it("does not warn when sending to a trusted recipient", async () => {
    const data = encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [ATTACKER, 5n] });
    const logs = [transferLog(USDG, AGENT, ATTACKER, 5n)];
    const r = await checkTransaction(tx(USDG, data), { trustedRecipients: [ATTACKER] }, { client: mockClient({ logs }), sign: false });
    expect(r.verdict).toBe("ALLOW");
  });

  it("enforces per-token and native spend limits", async () => {
    const logs = [transferLog(USDG, AGENT, ROUTER, 2_000_000_000n), transferLog(NATIVE_ASSET, AGENT, ROUTER, 2n * 10n ** 18n), transferLog(WETH, ROUTER, AGENT, 1n)];
    const r = await checkTransaction(tx(ROUTER, "0xdeadbeef"), { maxTokenOut: { [USDG]: "1000000000" }, maxNativeOut: "1000000000000000000" }, { client: mockClient({ logs, balances: { native: 10n ** 20n } }), sign: false });
    expect(r.verdict).toBe("DENY");
    expect(r.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["TOKEN_LIMIT", "NATIVE_LIMIT"]));
  });

  it("denies zero-address and non-allow-listed targets", async () => {
    expect((await checkTransaction(tx(zeroAddress, "0x", 1n), {}, { client: mockClient(), sign: false })).verdict).toBe("DENY");
    const r = await checkTransaction(tx(ROUTER, "0xdeadbeef"), { allowTargets: [WETH] }, { client: mockClient(), sign: false });
    expect(r.findings.map((f) => f.code)).toContain("TARGET_NOT_ALLOWED");
  });

  it("warns on setApprovalForAll and when the simulator is down", async () => {
    const data = encodeFunctionData({ abi: ERC20, functionName: "setApprovalForAll", args: [ROUTER, true] });
    const r = await checkTransaction(tx(ROUTER, data), {}, { client: mockClient({ simFails: true }), sign: false });
    expect(r.verdict).toBe("WARN");
    expect(r.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["UNLIMITED_APPROVAL", "SIM_UNAVAILABLE"]));
  });

  it("signs a verifiable EIP-712 receipt", async () => {
    const r = await checkTransaction(tx(WETH, "0xd0e30db0", 1n), {}, { client: mockClient() });
    const m = r.receipt!.message;
    const valid = await verifyTypedData({
      address: r.receipt!.signer, domain: receiptDomain(4663), types: RECEIPT_TYPES, primaryType: "Receipt",
      message: { ...m, value: BigInt(m.value), expiresAt: BigInt(m.expiresAt) }, signature: r.receipt!.signature,
    });
    expect(valid).toBe(true);
    expect(m.dataHash).toBe(keccak256("0xd0e30db0"));
  });

  it("parses native pseudo-transfers from traceTransfers", () => {
    const { transfers } = parseLogs([transferLog(NATIVE_ASSET, AGENT, ROUTER, 7n)]);
    expect(transfers[0]).toMatchObject({ kind: "native", amount: 7n });
  });
});

describe("HTTP API", () => {
  const app = buildApp({ getClient: () => mockClient(), store: new MemoryStore(), log: () => {} });
  it("rejects malformed requests", async () => {
    const res = await app.request("/v1/check", { method: "POST", body: JSON.stringify({ from: "nope" }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(400);
  });
  it("returns a verdict as JSON", async () => {
    const data = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ATTACKER, maxUint256] });
    const res = await app.request("/v1/check", { method: "POST", body: JSON.stringify({ from: AGENT, to: USDG, data }), headers: { "content-type": "application/json" } });
    const body = await res.json() as { verdict: string; receipt: { signature: string } };
    expect(res.status).toBe(200);
    expect(body.verdict).toBe("DENY");
    expect(body.receipt.signature).toMatch(/^0x/);
  });
});
