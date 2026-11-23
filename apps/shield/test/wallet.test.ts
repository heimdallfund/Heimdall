import { describe, it, expect, beforeEach } from "vitest";
import { encodeEventTopics, getAddress, parseAbi, maxUint256, type Address, type PublicClient } from "viem";
import { scanWallet } from "../src/approvals.js";
import { MemoryStore } from "../src/store.js";
import { award, claimRevoke, countCheck, decideReport, leaderboard, rememberFlagged, submitReport, walletPoints, applyDepositSnapshot, RULES } from "../src/points.js";
import { isBlocklisted, resetBlocklist } from "../src/blocklist.js";

const OWNER = getAddress("0x1111111111111111111111111111111111111111");
const USDG = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const MEME = getAddress("0x7777777777777777777777777777777777777777");
const DRAINER = getAddress("0x3333333333333333333333333333333333333333");
const ROUTER = getAddress("0xcaf681a66d020601342297493863e78c959e5cb2");
const UNKNOWN = getAddress("0x9999999999999999999999999999999999999999");
const EV = parseAbi(["event Approval(address indexed owner, address indexed spender, uint256 value)"]);
const approvalLog = (token: Address, spender: Address) => ({ address: token, topics: encodeEventTopics({ abi: EV, eventName: "Approval", args: { owner: OWNER, spender } }), data: "0x" });

function mockClient(allowances: Record<string, bigint>, opts: { logs?: ReturnType<typeof approvalLog>[]; calls?: { n: number } } = {}) {
  const contracts = new Set([USDG, MEME, ROUTER, UNKNOWN].map((a) => a.toLowerCase()));
  return {
    getBlockNumber: async () => 1_000_000n,
    getTransactionCount: async () => { throw new Error("historical state not available"); },
    getCode: async ({ address }: { address: Address }) => (contracts.has(address.toLowerCase()) ? "0x6080" : "0x"),
    request: async ({ method, params }: { method: string; params: [{ address?: string; fromBlock: string; toBlock: string }] }) => {
      if (method !== "eth_getLogs") throw new Error("unexpected");
      if (opts.calls) opts.calls.n++;
      const p = params[0];
      return (opts.logs ?? []).filter((l) => !p.address || l.address.toLowerCase() === p.address.toLowerCase());
    },
    multicall: async ({ contracts: cs }: { contracts: { address: Address; functionName: string; args?: unknown[] }[] }) => cs.map((c) => {
      if (c.functionName === "allowance" && c.args?.length === 2) return { status: "success", result: allowances[`${c.address.toLowerCase()}|${String(c.args[1]).toLowerCase()}`] ?? 0n };
      if (c.functionName === "allowance") return { status: "success", result: [0n, 0, 0] };
      if (c.functionName === "symbol") return { status: "success", result: c.address.toLowerCase() === USDG.toLowerCase() ? "USDG" : "MEME" };
      if (c.functionName === "decimals") return { status: "success", result: c.address.toLowerCase() === USDG.toLowerCase() ? 6 : 18 };
      if (c.functionName === "balanceOf") return { status: "success", result: c.address.toLowerCase() === USDG.toLowerCase() ? 2_500_000_000n : 0n };
      return { status: "failure" };
    }),
  } as unknown as PublicClient;
}
const noFetch = (async () => new Response("[]", { status: 404 })) as typeof fetch;

describe("Wallet Check", () => {
  beforeEach(() => { process.env.SHIELD_BLOCKLIST = DRAINER; resetBlocklist(); });

  it("finds live approvals, ranks wallet spenders as danger and known routers as ok, and values the exposure", async () => {
    const client = mockClient({
      [`${USDG.toLowerCase()}|${DRAINER.toLowerCase()}`]: maxUint256,
      [`${USDG.toLowerCase()}|${ROUTER.toLowerCase()}`]: 100_000_000n,
      [`${MEME.toLowerCase()}|${UNKNOWN.toLowerCase()}`]: maxUint256,
    }, { logs: [approvalLog(MEME, UNKNOWN)] });
    const r = await scanWallet(OWNER, { client, fetcher: noFetch, env: { LOG_WINDOW: "500000" } });
    expect(r.approvals.map((a) => [a.risk, a.symbol, a.spender])).toEqual([
      ["danger", "USDG", DRAINER],
      ["review", "MEME", UNKNOWN],
      ["ok", "USDG", ROUTER],
    ]);
    expect(r.approvals[0].reasons.join(" ")).toMatch(/blocklist/);
    expect(r.approvals[0].atRiskUsd).toBe(2500); // whole USDG balance is exposed
    expect(r.approvals[2].spenderLabel).toBe("Uniswap SwapRouter02");
    expect(r.summary).toMatchObject({ total: 3, danger: 1, review: 1, atRiskUsd: 2500 });
    expect(r.complete).toBe(true);
    expect(r.progress).toBe(100);
  });

  it("drops revoked (zero) allowances", async () => {
    const r = await scanWallet(OWNER, { client: mockClient({}), fetcher: noFetch, env: {} });
    expect(r.approvals).toHaveLength(0);
  });

  it("stops at its request budget and resumes from where it stopped", async () => {
    const store = new MemoryStore();
    const calls = { n: 0 };
    const env = { LOG_WINDOW: "100000", SCAN_MAX_REQUESTS: "5" };
    const a = await scanWallet(OWNER, { client: mockClient({}, { calls }), store, fetcher: noFetch, env });
    expect(a.complete).toBe(false);
    expect(a.progress).toBeGreaterThan(0);
    let last = a;
    for (let i = 0; i < 12 && !last.complete; i++) last = await scanWallet(OWNER, { client: mockClient({}, { calls }), store, fetcher: noFetch, env });
    expect(last.complete).toBe(true);
    expect(last.progress).toBe(100);
    const before = calls.n;
    await scanWallet(OWNER, { client: mockClient({}, { calls }), store, fetcher: noFetch, env });
    expect(calls.n - before).toBeLessThan(15); // a finished wallet only rescans the recent window and new blocks
  });
});

describe("Guardian Points", () => {
  it("awards once per dedupe key and ranks the leaderboard", async () => {
    const s = new MemoryStore();
    expect(await award(s, OWNER, "revoke", 50, "x")).toBe(50);
    expect(await award(s, OWNER, "revoke", 50, "x")).toBe(0);
    await award(s, DRAINER, "report", 200);
    const board = await leaderboard(s);
    expect(board.map((r) => r.total)).toEqual([200, 50]);
    const me = await walletPoints(s, OWNER);
    expect(me).toMatchObject({ total: 50, rank: 2, breakdown: { revoke: 50 } });
  });

  it("pays a revoke only for an approval Wallet Check flagged, verified from the receipt", async () => {
    const s = new MemoryStore();
    await rememberFlagged(s, OWNER, [{ token: USDG, spender: DRAINER }]);
    const logs = [
      { ...approvalLog(USDG, DRAINER), data: "0x" + "0".repeat(64), blockNumber: 1n, logIndex: 0, transactionHash: "0x" + "aa".repeat(32), transactionIndex: 0, blockHash: "0x" + "bb".repeat(32), removed: false },
      { ...approvalLog(USDG, ROUTER), data: "0x" + "0".repeat(64), blockNumber: 1n, logIndex: 1, transactionHash: "0x" + "aa".repeat(32), transactionIndex: 0, blockHash: "0x" + "bb".repeat(32), removed: false },
    ];
    const client = { getTransactionReceipt: async () => ({ status: "success", logs }), getTransaction: async () => ({ from: OWNER }) } as unknown as PublicClient;
    const r = await claimRevoke(s, client, OWNER, ("0x" + "aa".repeat(32)) as `0x${string}`);
    expect(r.awarded).toBe(RULES.revoke); // the router revoke was not flagged, so it earns nothing
    expect((await claimRevoke(s, client, OWNER, ("0x" + "aa".repeat(32)) as `0x${string}`)).awarded).toBe(0);
    const other = { ...client, getTransaction: async () => ({ from: DRAINER }) } as unknown as PublicClient;
    expect((await claimRevoke(s, other, OWNER, ("0x" + "aa".repeat(32)) as `0x${string}`)).error).toBe("not_sender");
  });

  it("confirmed drainer reports pay the reporter and join the blocklist", async () => {
    const s = new MemoryStore(); resetBlocklist();
    const r = await submitReport(s, { reporter: OWNER, address: UNKNOWN, evidence: "https://example.com/tx" });
    const blocked: string[] = [];
    const d = await decideReport(s, r.id, true, (a) => blocked.push(a));
    expect(d?.status).toBe("confirmed");
    expect(blocked).toEqual([UNKNOWN.toLowerCase()]);
    expect((await walletPoints(s, OWNER)).total).toBe(RULES.report);
    expect(await decideReport(s, r.id, true, () => {})).toBeNull(); // already decided
  });

  it("checks with an API key earn a point per 100, and deposit snapshots pay once per day", async () => {
    const s = new MemoryStore();
    for (let i = 0; i < 250; i++) await countCheck(s, OWNER, Date.UTC(2026, 10, 23));
    expect((await walletPoints(s, OWNER)).breakdown.checks).toBe(2);
    expect(await applyDepositSnapshot(s, "2026-11-23", { [OWNER]: 2_550 })).toBe(25);
    expect(await applyDepositSnapshot(s, "2026-11-23", { [OWNER]: 2_550 })).toBe(0);
  });
});

it("community blocklist entries are enforced", async () => {
  const { addCommunityBlock } = await import("../src/blocklist.js");
  resetBlocklist();
  addCommunityBlock(UNKNOWN);
  expect(isBlocklisted(UNKNOWN)).toBe(true);
});

describe("Wallet Check, incremental", () => {
  beforeEach(() => { process.env.SHIELD_BLOCKLIST = DRAINER; resetBlocklist(); });

  it("rescans a finished wallet with one query for the new blocks and still finds a new approval", async () => {
    const store = new MemoryStore();
    const calls = { n: 0 };
    const env = { LOG_WINDOW: "2000000" };
    let head = 1_000_000n;
    const allowances: Record<string, bigint> = {};
    const logs: ReturnType<typeof approvalLog>[] = [];
    const client = () => ({ ...mockClient(allowances, { logs, calls }), getBlockNumber: async () => head }) as unknown as PublicClient;
    const first = await scanWallet(OWNER, { client: client(), store, fetcher: noFetch, env });
    expect(first.complete).toBe(true);
    const before = calls.n;
    head += 5_000n;
    logs.push(approvalLog(MEME, UNKNOWN));
    allowances[`${MEME.toLowerCase()}|${UNKNOWN.toLowerCase()}`] = maxUint256;
    const second = await scanWallet(OWNER, { client: client(), store, fetcher: noFetch, env });
    expect(calls.n - before).toBe(2); // the new blocks, plus the full history of the token it did not hold before
    expect(second.sources).toContain("new blocks since last scan");
    expect(second.approvals.map((a) => [a.risk, a.spender])).toEqual([["review", UNKNOWN]]);
    const third = await scanWallet(OWNER, { client: client(), store, fetcher: noFetch, env: { ...env } });
    expect(third.approvals).toHaveLength(1);
  });
});

describe("Wallet Watch quick rescan", () => {
  beforeEach(() => { process.env.SHIELD_BLOCKLIST = DRAINER; resetBlocklist(); });

  it("reuses the last report when nothing happened, and re-checks fully when a spender is newly blocklisted", async () => {
    const store = new MemoryStore();
    const calls = { n: 0 }; let multicalls = 0;
    let head = 2_000_000n;
    const allowances = { [`${MEME.toLowerCase()}|${UNKNOWN.toLowerCase()}`]: maxUint256 };
    const client = () => { const c = mockClient(allowances, { logs: [approvalLog(MEME, UNKNOWN)], calls }) as unknown as Record<string, unknown>; const mc = c.multicall as (a: unknown) => unknown; return { ...c, getBlockNumber: async () => head, multicall: (a: unknown) => { multicalls++; return mc(a); } } as unknown as PublicClient; };
    const first = await scanWallet(OWNER, { client: client(), store, fetcher: noFetch, env: {} });
    expect(first.approvals.map((a) => a.risk)).toEqual(["review"]);
    head += 9_000n; const mcBefore = multicalls; const before = calls.n;
    const noLogs = () => { const c = client() as unknown as Record<string, unknown>; return { ...c, request: async () => { calls.n++; return []; } } as unknown as PublicClient; };
    const quick = await scanWallet(OWNER, { client: noLogs(), store, fetcher: noFetch, env: {}, quick: true });
    expect(quick.sources).toContain("no change since last scan");
    expect(quick.approvals.map((a) => a.risk)).toEqual(["review"]);
    expect(calls.n - before).toBe(1);
    expect(multicalls - mcBefore).toBe(0);
    process.env.SHIELD_BLOCKLIST = `${DRAINER},${UNKNOWN}`; resetBlocklist();
    head += 9_000n;
    const flagged = await scanWallet(OWNER, { client: noLogs(), store, fetcher: noFetch, env: {}, quick: true });
    expect(flagged.sources).not.toContain("no change since last scan");
    expect(flagged.approvals.map((a) => a.risk)).toEqual(["danger"]);
  });
});
