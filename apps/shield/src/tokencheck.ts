import { createPublicClient, encodeAbiParameters, encodeFunctionData, getAddress, http, maxUint256, parseAbi, parseAbiItem, toHex, type Address, type Hex, type PublicClient } from "viem";
import { assessHooks, POOL_MANAGER, UNIVERSAL_ROUTER } from "./v4hooks.js";
import { isBlocklisted, blocklistEntries } from "./blocklist.js";
import { fakeTokenCheck } from "./impersonation.js";
import { TOKENS } from "./registry.js";
import { parseLogs, decodeRevert, probeReceivedToken, STRANGER, type RawLog } from "./simulate.js";
import type { Finding, Verdict } from "./types.js";

/**
 * Token Check: is a token safe to buy? Finds its Uniswap v3 pool against WETH, then simulates on the current chain
 * state, with a throwaway buyer that is given 1 ETH for the simulation only:
 *   buy → transfer → approve + sell back, and whether a stranger or the owner can pull the tokens out of the wallet.
 * Taxes are measured from the Transfer events (what left the pool vs what arrived), so no price quote is needed.
 */
export const UNISWAP_V3_FACTORY: Address = getAddress("0x1f7d7550b1b028f7571e69a784071f0205fd2efa");
export const SWAP_ROUTER_02: Address = getAddress("0xcaf681a66d020601342297493863e78c959e5cb2");
export const WETH: Address = getAddress("0x0bd7d308f8e1639fab988df18a8011f41eacad73");
const FEES = [100, 500, 3000, 10000] as const;
const BUYER: Address = getAddress("0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0");
const BUY_WEI = 10n ** 15n; // 0.001 ETH: small enough to fit any pool, large enough to measure a tax

const FACTORY_ABI = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const POOL_ABI = parseAbi(["function liquidity() view returns (uint128)"]);
const ERC20 = parseAbi([
  "function symbol() view returns (string)", "function name() view returns (string)", "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)", "function owner() view returns (address)",
  "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)",
]);
const ROUTER_ABI = parseAbi(["function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256)"]);

const PERMIT2: Address = getAddress("0x000000000022d473030f116ddee9f6b43ac78ba3");
const STATE_VIEW: Address = getAddress("0xf3334192d15450cdd385c8b70e03f9a6bd9e673b");
const NATIVE: Address = "0x0000000000000000000000000000000000000000";
/** The public RPC serves wide log queries (10M blocks each); paid RPCs on free plans often allow only a few blocks. */
const logsClient = createPublicClient({ transport: http(process.env.LOGS_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", { timeout: 8_000 }) });
const INITIALIZE = parseAbiItem("event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)");
type V4Key = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
const v4Caches = new WeakMap<PublicClient, Map<string, { at: number; pool: (V4Key & { id: Hex; liquidity: bigint }) | null }>>();

/** The deepest Uniswap v4 pool of a token against ETH or WETH, found from PoolManager Initialize events. */
async function findV4Pool(client: PublicClient, token: Address, logs: PublicClient = logsClient) {
  const k = token.toLowerCase();
  let v4Cache = v4Caches.get(logs);
  if (!v4Cache) v4Caches.set(logs, (v4Cache = new Map()));
  const hit = v4Cache.get(k);
  if (hit && Date.now() - hit.at < 600_000) return hit.pool;
  const head = await logs.getBlockNumber().catch(() => 0n);
  const STEP = 10_000_000n;
  const windows: [bigint, bigint][] = [];
  for (let to = head; to > 0n; to -= STEP) windows.push([to - STEP + 1n > 1n ? to - STEP + 1n : 1n, to]);
  const found = (await Promise.all(windows.flatMap(([from, to]) => [{ currency1: token }, { currency0: token }].map((args) =>
    logs.getLogs({ address: POOL_MANAGER, event: INITIALIZE, args: args as never, fromBlock: from, toBlock: to }).catch(() => []))))).flat();
  const pair = (l: (typeof found)[number]) => (l.args.currency0!.toLowerCase() === k ? l.args.currency1! : l.args.currency0!).toLowerCase();
  // pools against ETH or WETH, newest first; spam pools are common, so only the 25 newest are measured
  const cands = found.filter((l) => [NATIVE.toLowerCase(), WETH.toLowerCase()].includes(pair(l))).sort((a, b) => Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n))).slice(0, 25);
  const SV = parseAbi(["function getLiquidity(bytes32 poolId) view returns (uint128)"]);
  const measured = await Promise.all(cands.map(async (l) => ({ l, liquidity: await client.readContract({ address: STATE_VIEW, abi: SV, functionName: "getLiquidity", args: [l.args.id!] }).catch(() => 0n) })));
  const best = measured.filter((m) => m.liquidity > 0n).sort((a, b) => (b.liquidity > a.liquidity ? 1 : -1))[0];
  const pool = best ? { id: best.l.args.id!, currency0: getAddress(best.l.args.currency0!), currency1: getAddress(best.l.args.currency1!), fee: Number(best.l.args.fee), tickSpacing: Number(best.l.args.tickSpacing), hooks: getAddress(best.l.args.hooks!), liquidity: best.liquidity } : null;
  if (v4Cache.size > 2_000) v4Cache.delete(v4Cache.keys().next().value!);
  v4Cache.set(k, { at: Date.now(), pool });
  return pool;
}

const KEY_T = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] } as const;
const UR_EXECUTE = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline)"]);
/** Universal Router V4_SWAP: SWAP_EXACT_IN_SINGLE, SETTLE_ALL the input, TAKE_ALL the output. */
function v4SwapData(key: V4Key, zeroForOne: boolean, amountIn: bigint): Hex {
  const swap = encodeAbiParameters([{ type: "tuple", components: [{ name: "poolKey", ...KEY_T }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" }] }], [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: 0n, hookData: "0x" }]);
  const [cin, cout] = zeroForOne ? [key.currency0, key.currency1] : [key.currency1, key.currency0];
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [cin, amountIn]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [cout, 0n]);
  const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x060c0f", [swap, settle, take]]);
  return encodeFunctionData({ abi: UR_EXECUTE, functionName: "execute", args: ["0x10", [input], 4_000_000_000n] });
}
const PERMIT2_APPROVE = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const WETH_DEPOSIT = parseAbi(["function deposit() payable"]);

export interface TokenCheck {
  token: Address;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  totalSupply: string | null;
  owner: Address | null;
  verdict: Verdict;
  riskScore: number;
  findings: Finding[];
  pool: { version: 3 | 4; address: Address | Hex; fee: number; pair: "WETH" | "ETH"; liquidity: string; hooks?: Address } | null;
  buy: { ok: boolean; taxPct: number | null; reason?: string } | null;
  sell: { ok: boolean; taxPct: number | null; reason?: string } | null;
  transfer: { ok: boolean; taxPct: number | null; reason?: string } | null;
  pullableBy: ("anyone" | "owner")[];
  checkedAt: number;
}

const pct = (sent: bigint, got: bigint) => (sent > 0n ? Math.max(0, Number(((sent - got) * 10_000n) / sent) / 100) : null);

async function findPool(client: PublicClient, token: Address) {
  const pools = await Promise.all(FEES.map(async (fee) => {
    const address = await client.readContract({ address: UNISWAP_V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [WETH, token, fee] }).catch(() => undefined);
    if (!address || /^0x0{40}$/i.test(address)) return null;
    const liquidity = await client.readContract({ address, abi: POOL_ABI, functionName: "liquidity" }).catch(() => 0n);
    return { address: getAddress(address), fee, liquidity };
  }));
  return pools.filter((p): p is NonNullable<typeof p> => !!p && p.liquidity > 0n).sort((a, b) => (b.liquidity > a.liquidity ? 1 : -1))[0] ?? null;
}

async function sim(client: PublicClient, calls: { from: Address; to: Address; data: Hex; value?: bigint }[]) {
  const res: any = await client.request({
    method: "eth_simulateV1" as any,
    params: [{
      blockStateCalls: [{ stateOverrides: { [BUYER]: { balance: toHex(10n ** 18n) } }, calls: calls.map((c) => ({ from: c.from, to: c.to, data: c.data, value: toHex(c.value ?? 0n) })) }],
      traceTransfers: true, validation: false,
    }, "latest"] as any,
  });
  return (res?.[0]?.calls ?? []) as { status: string; logs?: RawLog[]; returnData?: Hex; error?: { data?: Hex; message?: string } }[];
}

export async function tokenCheck(client: PublicClient, raw: Address, now = Date.now(), logs: PublicClient = logsClient): Promise<TokenCheck> {
  const token = getAddress(raw);
  const F: Finding[] = [];
  const add = (code: string, severity: Finding["severity"], message: string) => F.push({ code, severity, message });
  const read = <T>(functionName: "symbol" | "name" | "decimals" | "totalSupply" | "owner") =>
    client.readContract({ address: token, abi: ERC20, functionName } as never).then((v) => v as T).catch(() => null);

  const [code, symbol, name, decimals, supply, owner, pool, fake] = await Promise.all([
    client.getCode({ address: token }).catch(() => undefined),
    read<string>("symbol"), read<string>("name"), read<number>("decimals"), read<bigint>("totalSupply"), read<Address>("owner"),
    findPool(client, token),
    fakeTokenCheck(client, token).catch(() => undefined),
  ]);
  const out: TokenCheck = {
    token, symbol, name, decimals: decimals === null ? null : Number(decimals), totalSupply: supply === null ? null : supply.toString(),
    owner: owner && !/^0x0{40}$/i.test(owner) ? getAddress(owner) : null,
    verdict: "ALLOW", riskScore: 0, findings: F, pool: null, buy: null, sell: null, transfer: null, pullableBy: [], checkedAt: now,
  };

  if (!code || code === "0x") {
    add("NOT_A_CONTRACT", "deny", "There is no contract at this address, so it is not a token.");
    return finish(out);
  }
  if (TOKENS[token.toLowerCase()]) add("KNOWN_TOKEN", "info", `This is the real ${TOKENS[token.toLowerCase()]!.symbol}.`);
  if (symbol === null || decimals === null) add("NOT_ERC20", "warn", "The contract does not answer symbol() or decimals(), so wallets cannot treat it as a normal token.");
  if (isBlocklisted(token)) {
    const e = blocklistEntries().find((b) => b.address.toLowerCase() === token.toLowerCase());
    add("BLOCKLISTED_CONTRACT", "deny", `On the Heimdall blocklist${e?.label ? `: ${e.label}` : ""}.`);
  }
  if (fake) {
    if (fake.by === "symbol") add("FAKE_TOKEN", "deny", `Calls itself ${fake.symbol}, but the real ${fake.symbol} is ${fake.real}.`);
    else add("FAKE_TOKEN", "warn", `Uses the name of ${fake.symbol} but is not the real ${fake.symbol} (${fake.real}).`);
  }
  if (out.owner) add("HAS_OWNER", "info", `Has an owner (${out.owner}) who may hold special powers over the contract.`);

  if (!pool) {
    const v4 = await findV4Pool(client, token, logs).catch(() => null);
    if (v4) return finishV4(client, out, token, v4, add);
    add("NO_POOL", "warn", "No Uniswap v3 or v4 pool against ETH or WETH with liquidity: it cannot be bought or sold there, and the buy and sell could not be simulated.");
    return finish(out);
  }
  out.pool = { version: 3, address: pool.address, fee: pool.fee, pair: "WETH", liquidity: pool.liquidity.toString() };

  // Buy
  const buyData = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: WETH, tokenOut: token, fee: pool.fee, recipient: BUYER, amountIn: BUY_WEI, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] });
  const buyCall = { from: BUYER, to: SWAP_ROUTER_02, data: buyData, value: BUY_WEI };
  let bought = 0n;
  try {
    const [b] = await sim(client, [buyCall]);
    if (!b || b.status !== "0x1") {
      out.buy = { ok: false, taxPct: null, reason: decodeRevert(b?.error?.data ?? b?.returnData, b?.error?.message) };
      add("BUY_FAILS", "deny", `Buying reverts: ${out.buy.reason}.`);
      return finish(out);
    }
    const tr = parseLogs(b.logs ?? []).transfers.filter((t) => t.asset.toLowerCase() === token.toLowerCase());
    const fromPool = tr.filter((t) => t.from.toLowerCase() === pool.address.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
    bought = tr.filter((t) => t.to.toLowerCase() === BUYER.toLowerCase()).reduce((a, t) => a + t.amount, 0n) - tr.filter((t) => t.from.toLowerCase() === BUYER.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
    out.buy = { ok: true, taxPct: pct(fromPool, bought > 0n ? bought : 0n) };
    if (bought <= 0n) { add("VANISHING_TOKEN", "deny", "The buy goes through, but the tokens do not stay in the buyer's wallet."); return finish(out); }
    taxFinding(add, "BUY", out.buy.taxPct);
  } catch (e) {
    add("SIM_UNAVAILABLE", "warn", `Could not simulate: ${(e as Error).message.split("\n")[0]}.`);
    return finish(out);
  }

  // Sell, transfer and backdoors, each after the same buy
  const sellAmount = bought;
  const approve = { from: BUYER, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [SWAP_ROUTER_02, maxUint256] }) };
  const sellData = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: token, tokenOut: WETH, fee: pool.fee, recipient: BUYER, amountIn: sellAmount, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] });
  const transferCall = { from: BUYER, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [STRANGER, sellAmount] }) };
  const [sellRes, transferRes, deep] = await Promise.all([
    sim(client, [buyCall, approve, { from: BUYER, to: SWAP_ROUTER_02, data: sellData }]).catch(() => null),
    sim(client, [buyCall, transferCall]).catch(() => null),
    probeReceivedToken(client, { chainId: 4663, from: BUYER, to: SWAP_ROUTER_02, data: buyData, value: BUY_WEI, overrides: { [BUYER]: { balance: toHex(10n ** 18n) } } }, token, sellAmount),
  ]);

  const s = sellRes?.[2];
  if (s) {
    if (s.status !== "0x1") {
      out.sell = { ok: false, taxPct: null, reason: decodeRevert(s.error?.data ?? s.returnData, s.error?.message) };
      add("HONEYPOT", "deny", `Buying works but selling reverts (${out.sell.reason}). This is a honeypot.`);
    } else {
      const tr = parseLogs(s.logs ?? []).transfers.filter((t) => t.asset.toLowerCase() === token.toLowerCase());
      const toPool = tr.filter((t) => t.to.toLowerCase() === pool.address.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
      out.sell = { ok: true, taxPct: pct(sellAmount, toPool) };
      taxFinding(add, "SELL", out.sell.taxPct);
    }
  }
  const t = transferRes?.[1];
  if (t) {
    if (t.status !== "0x1") {
      out.transfer = { ok: false, taxPct: null, reason: decodeRevert(t.error?.data ?? t.returnData, t.error?.message) };
      add("TRANSFER_BLOCKED", "deny", `Tokens cannot be sent to another wallet after buying (${out.transfer.reason}).`);
    } else {
      const got = parseLogs(t.logs ?? []).transfers.filter((x) => x.asset.toLowerCase() === token.toLowerCase() && x.to.toLowerCase() === STRANGER.toLowerCase()).reduce((a, x) => a + x.amount, 0n);
      out.transfer = { ok: true, taxPct: pct(sellAmount, got) };
      taxFinding(add, "TRANSFER", out.transfer.taxPct);
    }
  }
  out.pullableBy = deep.pulledBy.map((a) => (a.toLowerCase() === STRANGER.toLowerCase() ? "anyone" : "owner"));
  if (out.pullableBy.length) add("ALLOWANCE_BYPASS", "deny", `${out.pullableBy.includes("anyone") ? "Anyone" : "The owner"} can take the tokens out of a holder's wallet without an approval: what you buy can be clawed back.`);
  return finish(out);
}

/** Buy and sell through the Universal Router on a v4 pool, then the same transfer and clawback tests. */
async function finishV4(client: PublicClient, out: TokenCheck, token: Address, p: V4Key & { id: Hex; liquidity: bigint }, add: (c: string, s: Finding["severity"], m: string) => void): Promise<TokenCheck> {
  const native = p.currency0.toLowerCase() === NATIVE.toLowerCase() || p.currency1.toLowerCase() === NATIVE.toLowerCase();
  const pairToken = native ? NATIVE : WETH;
  out.pool = { version: 4, address: p.id, fee: p.fee, pair: native ? "ETH" : "WETH", liquidity: p.liquidity.toString(), hooks: p.hooks };
  F_push(out, await assessHooks(client, [{ currency0: p.currency0, currency1: p.currency1, fee: p.fee, hooks: p.hooks }]));
  const key: V4Key = { currency0: p.currency0, currency1: p.currency1, fee: p.fee, tickSpacing: p.tickSpacing, hooks: p.hooks };
  const buyZeroForOne = p.currency0.toLowerCase() === pairToken.toLowerCase();
  const ERC = parseAbi(["function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"]);
  // with WETH as the pair, the buyer wraps ETH and lets Permit2 and the router spend it first
  const prep = native ? [] : [
    { from: BUYER, to: WETH, data: encodeFunctionData({ abi: WETH_DEPOSIT, functionName: "deposit" }), value: BUY_WEI },
    { from: BUYER, to: WETH, data: encodeFunctionData({ abi: ERC, functionName: "approve", args: [PERMIT2, maxUint256] }) },
    { from: BUYER, to: PERMIT2, data: encodeFunctionData({ abi: PERMIT2_APPROVE, functionName: "approve", args: [WETH, UNIVERSAL_ROUTER, (1n << 160n) - 1n, 281474976710655] }) },
  ];
  const buyCall = { from: BUYER, to: UNIVERSAL_ROUTER, data: v4SwapData(key, buyZeroForOne, BUY_WEI), value: native ? BUY_WEI : 0n };
  let bought = 0n;
  try {
    const res = await sim(client, [...prep, buyCall]);
    const b = res[prep.length];
    if (!b || b.status !== "0x1") {
      // a v4 buy can fail for reasons that are not the token's (route, hook data), so it is a warning here
      out.buy = { ok: false, taxPct: null, reason: decodeRevert(b?.error?.data ?? b?.returnData, b?.error?.message) };
      add("BUY_FAILS", "warn", `Buying through the Uniswap v4 pool reverts: ${out.buy.reason}.`);
      return finish(out);
    }
    const tr = parseLogs(b.logs ?? []).transfers.filter((t) => t.asset.toLowerCase() === token.toLowerCase());
    const fromPm = tr.filter((t) => t.from.toLowerCase() === POOL_MANAGER.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
    bought = tr.filter((t) => t.to.toLowerCase() === BUYER.toLowerCase()).reduce((a, t) => a + t.amount, 0n) - tr.filter((t) => t.from.toLowerCase() === BUYER.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
    out.buy = { ok: true, taxPct: pct(fromPm, bought > 0n ? bought : 0n) };
    if (bought <= 0n) { add("VANISHING_TOKEN", "deny", "The buy goes through, but the tokens do not stay in the buyer's wallet."); return finish(out); }
    taxFinding(add, "BUY", out.buy.taxPct);
  } catch (e) {
    add("SIM_UNAVAILABLE", "warn", `Could not simulate: ${(e as Error).message.split("\n")[0]}.`);
    return finish(out);
  }
  const before = [...prep, buyCall];
  const sellCalls = [
    { from: BUYER, to: token, data: encodeFunctionData({ abi: ERC, functionName: "approve", args: [PERMIT2, maxUint256] }) },
    { from: BUYER, to: PERMIT2, data: encodeFunctionData({ abi: PERMIT2_APPROVE, functionName: "approve", args: [token, UNIVERSAL_ROUTER, (1n << 160n) - 1n, 281474976710655] }) },
    { from: BUYER, to: UNIVERSAL_ROUTER, data: v4SwapData(key, !buyZeroForOne, bought) },
  ];
  const [sellRes, transferRes, deep] = await Promise.all([
    sim(client, [...before, ...sellCalls]).catch(() => null),
    sim(client, [...before, { from: BUYER, to: token, data: encodeFunctionData({ abi: ERC, functionName: "transfer", args: [STRANGER, bought] }) }]).catch(() => null),
    native ? probeReceivedToken(client, { chainId: 4663, from: BUYER, to: UNIVERSAL_ROUTER, data: buyCall.data, value: BUY_WEI, overrides: { [BUYER]: { balance: toHex(10n ** 18n) } } }, token, bought) : Promise.resolve({ pulledBy: [] as Address[] }),
  ]);
  const s = sellRes?.[before.length + 2];
  if (s) {
    if (s.status !== "0x1") {
      out.sell = { ok: false, taxPct: null, reason: decodeRevert(s.error?.data ?? s.returnData, s.error?.message) };
      add("HONEYPOT", "deny", `Buying works but selling reverts (${out.sell.reason}). This is a honeypot.`);
    } else {
      const toPm = parseLogs(s.logs ?? []).transfers.filter((t) => t.asset.toLowerCase() === token.toLowerCase() && t.to.toLowerCase() === POOL_MANAGER.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
      out.sell = { ok: true, taxPct: pct(bought, toPm) };
      taxFinding(add, "SELL", out.sell.taxPct);
    }
  }
  const t = transferRes?.[before.length];
  if (t) {
    if (t.status !== "0x1") {
      out.transfer = { ok: false, taxPct: null, reason: decodeRevert(t.error?.data ?? t.returnData, t.error?.message) };
      add("TRANSFER_BLOCKED", "deny", `Tokens cannot be sent to another wallet after buying (${out.transfer.reason}).`);
    } else {
      const got = parseLogs(t.logs ?? []).transfers.filter((x) => x.asset.toLowerCase() === token.toLowerCase() && x.to.toLowerCase() === STRANGER.toLowerCase()).reduce((a, x) => a + x.amount, 0n);
      out.transfer = { ok: true, taxPct: pct(bought, got) };
      taxFinding(add, "TRANSFER", out.transfer.taxPct);
    }
  }
  out.pullableBy = deep.pulledBy.map((a) => (a.toLowerCase() === STRANGER.toLowerCase() ? "anyone" : "owner"));
  if (out.pullableBy.length) add("ALLOWANCE_BYPASS", "deny", `${out.pullableBy.includes("anyone") ? "Anyone" : "The owner"} can take the tokens out of a holder's wallet without an approval: what you buy can be clawed back.`);
  return finish(out);
}

function F_push(out: TokenCheck, f: Finding[]) { out.findings.push(...f); }

function taxFinding(add: (c: string, s: Finding["severity"], m: string) => void, kind: "BUY" | "SELL" | "TRANSFER", tax: number | null) {
  if (tax === null || tax < 0.5) return;
  const what = kind === "BUY" ? "buy" : kind === "SELL" ? "sell" : "transfer";
  add(`${kind}_TAX`, tax >= 50 ? "deny" : tax >= 10 ? "warn" : "info", `${tax.toFixed(1)}% tax on every ${what}.`);
}

function finish(out: TokenCheck): TokenCheck {
  const deny = out.findings.filter((f) => f.severity === "deny").length;
  const warn = out.findings.filter((f) => f.severity === "warn").length;
  out.verdict = deny ? "DENY" : warn ? "WARN" : "ALLOW";
  out.riskScore = deny ? Math.min(100, 85 + deny * 5 + warn * 2) : Math.min(80, warn * 25);
  return out;
}
