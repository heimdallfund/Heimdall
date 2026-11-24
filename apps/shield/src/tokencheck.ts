import { createPublicClient, encodeAbiParameters, encodeFunctionData, getAddress, http, maxUint256, parseAbi, parseAbiItem, toHex, type Address, type Hex, type PublicClient } from "viem";
import { assessHooks, POOL_MANAGER, UNIVERSAL_ROUTER } from "./v4hooks.js";
import { isBlocklisted, blocklistEntries } from "./blocklist.js";
import { fakeTokenCheck } from "./impersonation.js";
import { TOKENS } from "./registry.js";
import { parseLogs, decodeRevert, probeReceivedToken, STRANGER, type RawLog } from "./simulate.js";
import type { Finding, Verdict } from "./types.js";
import { detectLaunch, LAUNCHPAD_HOOKS, type Launch } from "./launchpad.js";
import { memecoinSignals, type Holders } from "./memecoin.js";
import { eachWindow } from "./windowlogs.js";
import { BUYER as DEEP_BUYER, deepTests, type Powers, type Route } from "./powers.js";
import { liquidityFindings, v3Liquidity, v4Liquidity, type Liquidity } from "./lp.js";

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
  const found = await eachWindow(head, 10_000_000n, async (from, to) => (await Promise.all([{ currency1: token }, { currency0: token }].map((args) =>
    logs.getLogs({ address: POOL_MANAGER, event: INITIALIZE, args: args as never, fromBlock: from, toBlock: to })))).flat());
  const pair = (l: (typeof found)[number]) => (l.args.currency0!.toLowerCase() === k ? l.args.currency1! : l.args.currency0!).toLowerCase();
  // pools against ETH or WETH, newest first; spam pools are common, so only the 25 newest are measured
  const cands = found.filter((l) => [NATIVE.toLowerCase(), WETH.toLowerCase()].includes(pair(l))).sort((a, b) => Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n))).slice(0, 25);
  const SV = parseAbi(["function getLiquidity(bytes32 poolId) view returns (uint128)"]);
  // one multicall instead of 25 calls: paid RPC plans throttle bursts, and a dropped read made a deep pool look empty
  type Res = { status: string; result?: bigint };
  const one = (l: (typeof cands)[number]): Promise<Res> => client.readContract({ address: STATE_VIEW, abi: SV, functionName: "getLiquidity", args: [l.args.id!] }).then((result) => ({ status: "success", result }), () => ({ status: "failure" }));
  const liq: Res[] = await (client.multicall({ contracts: cands.map((l) => ({ address: STATE_VIEW, abi: SV, functionName: "getLiquidity", args: [l.args.id!] })) as never, allowFailure: true }) as Promise<Res[]>)
    .catch(() => Promise.all(cands.map(one)));
  const measured = cands.map((l, i) => ({ l, liquidity: liq[i]?.status === "success" ? (liq[i]!.result ?? 0n) : 0n }));
  // launchpad pools (Klik and others) start with one-sided liquidity above the price: zero in range until the first buy,
  // so with no pool in range the newest one is still tried
  const best = measured.filter((m) => m.liquidity > 0n).sort((a, b) => (b.liquidity > a.liquidity ? 1 : -1))[0] ?? measured[0];
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
  /** The launchpad the token came from, its dev wallet, and whether it still trades on the launchpad's bonding curve. */
  launch: Launch | null;
  /** Who holds the supply: top holders, the dev's share, launch-block buyers. Null when it could not be read. */
  holders: Holders | null;
  /** What the owner can do to holders, each tested in the simulation. Null for known tokens and when not tested. */
  powers?: Powers | null;
  /** Pool depth and who can pull the liquidity. */
  liquidity?: Liquidity | null;
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

  const [code, symbol, name, decimals, supply, owner, pool, fake, launch] = await Promise.all([
    client.getCode({ address: token }).catch(() => undefined),
    read<string>("symbol"), read<string>("name"), read<number>("decimals"), read<bigint>("totalSupply"), read<Address>("owner"),
    findPool(client, token),
    fakeTokenCheck(client, token).catch(() => undefined),
    detectLaunch(client, token).catch(() => null),
  ]);
  const out: TokenCheck = {
    token, symbol, name, decimals: decimals === null ? null : Number(decimals), totalSupply: supply === null ? null : supply.toString(),
    owner: owner && !/^0x0{40}$/i.test(owner) ? getAddress(owner) : null,
    verdict: "ALLOW", riskScore: 0, findings: F, pool: null, buy: null, sell: null, transfer: null, pullableBy: [], checkedAt: now,
    launch, holders: null,
  };

  if (!code || code === "0x") {
    add("NOT_A_CONTRACT", "deny", "There is no contract at this address, so it is not a token.");
    return finish(out);
  }
  // holder and dev signals run beside the trade simulations; known tokens (USDG, stocks) skip them
  const signals = TOKENS[token.toLowerCase()] ? Promise.resolve(null) : memecoinSignals(client, logs, token, { supply, decimals, launch, pool: pool?.address ?? null }).catch(() => null);
  // deeper tests (owner powers, time-locked and size-limited selling, liquidity owners) run beside the main ones
  type Extra = { findings: Finding[]; powers: Powers | null; liquidity: Liquidity | null };
  let extra: Promise<Extra> = Promise.resolve({ findings: [], powers: null, liquidity: null });
  const startExtra = (route: Route | null, liq: Promise<Liquidity | null> = Promise.resolve(null)) => {
    if (TOKENS[token.toLowerCase()]) return;
    extra = Promise.all([deepTests(client, token, code!, out.owner, route).catch(() => null), liq.catch(() => null)])
      .then(([d, l]) => ({ findings: [...(d?.findings ?? []), ...(l ? liquidityFindings(l, launch?.dev ?? null) : [])], powers: d?.powers ?? null, liquidity: l }));
  };
  const done = async (r: TokenCheck | Promise<TokenCheck>) => {
    const res = await r;
    const [m, x] = await Promise.all([signals, extra]);
    if (m) { res.holders = m.holders; res.findings.push(...m.findings); }
    res.powers = x.powers; res.liquidity = x.liquidity; res.findings.push(...x.findings);
    // a launchpad's own fee hook is shared by every token it launched: a fact about the launchpad, not this token's dev
    const hook = res.pool?.hooks?.toLowerCase();
    if (hook && LAUNCHPAD_HOOKS[hook]) for (const f of res.findings) if (f.code === "HOOK_TAKES_DELTA") {
      f.severity = "info";
      f.message = `Trades go through ${LAUNCHPAD_HOOKS[hook]}'s fee hook, shared by all its tokens. It sets the swap fee; the simulated amounts above include it.`;
    }
    return finish(res);
  };
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

  if (launch) {
    const where = launch.graduated === false ? `still on its ${launch.launchpad} bonding curve${launch.progressPct === null ? "" : ` (${launch.progressPct.toFixed(1)}% to graduation)`}` : launch.graduated ? `graduated from ${launch.launchpad}` : `launched on ${launch.launchpad}`;
    add("LAUNCHPAD", "info", `Memecoin ${where}${launch.dev ? `, launched by ${launch.dev}` : ""}.`);
  }
  if (launch?.simulate === "ponsV2" && launch.curve) {
    startExtra(launch.pairToken ? null : curveRoute(token, launch.curve));
    return done(finishCurve(client, out, token, launch.curve, add, launch.pairToken));
  }
  if (launch?.model === "curve" && launch.graduated === false) {
    startExtra(null);
    add("CURVE_NOT_SIMULATED", "warn", `Still trades on the ${launch.launchpad} bonding curve, which Heimdall cannot simulate yet: whether it can be sold back was not tested.`);
    return done(out);
  }
  if (!pool) {
    const v4 = await findV4Pool(client, token, logs).catch(() => null);
    if (v4) {
      startExtra(v4Route(token, v4), v4Liquidity(client, logs, v4.id));
      return done(finishV4(client, out, token, v4, add));
    }
    startExtra(null);
    add("NO_POOL", "warn", "No Uniswap v3 or v4 pool against ETH or WETH with liquidity: it cannot be bought or sold there, and the buy and sell could not be simulated.");
    return done(out);
  }
  out.pool = { version: 3, address: pool.address, fee: pool.fee, pair: "WETH", liquidity: pool.liquidity.toString() };
  startExtra(v3Route(token, pool), v3Liquidity(client, logs, pool.address));

  // Buy
  const buyData = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: WETH, tokenOut: token, fee: pool.fee, recipient: BUYER, amountIn: BUY_WEI, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] });
  const buyCall = { from: BUYER, to: SWAP_ROUTER_02, data: buyData, value: BUY_WEI };
  let bought = 0n;
  try {
    const [b] = await sim(client, [buyCall]);
    if (!b || b.status !== "0x1") {
      out.buy = { ok: false, taxPct: null, reason: decodeRevert(b?.error?.data ?? b?.returnData, b?.error?.message) };
      add("BUY_FAILS", "deny", `Buying reverts: ${out.buy.reason}.`);
      return done(out);
    }
    const tr = parseLogs(b.logs ?? []).transfers.filter((t) => t.asset.toLowerCase() === token.toLowerCase());
    const fromPool = tr.filter((t) => t.from.toLowerCase() === pool.address.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
    bought = tr.filter((t) => t.to.toLowerCase() === BUYER.toLowerCase()).reduce((a, t) => a + t.amount, 0n) - tr.filter((t) => t.from.toLowerCase() === BUYER.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
    out.buy = { ok: true, taxPct: pct(fromPool, bought > 0n ? bought : 0n) };
    if (bought <= 0n) { add("VANISHING_TOKEN", "deny", "The buy goes through, but the tokens do not stay in the buyer's wallet."); return done(out); }
    taxFinding(add, "BUY", out.buy.taxPct);
  } catch (e) {
    add("SIM_UNAVAILABLE", "warn", `Could not simulate: ${(e as Error).message.split("\n")[0]}.`);
    return done(out);
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
  return done(out);
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

/**
 * Pons V2 bonding curve: buy with ETH, then transfer and sell back (after an approval), exactly as a trader would.
 * The curve emits nothing Heimdall depends on: amounts come from the token's Transfer events.
 */
const PONS_CURVE = parseAbi(["function buy(uint256 ethIn, uint256 minTokensOut, address to) payable returns (uint256)", "function sell(uint256 tokensIn, uint256 minEthOut, address to) returns (uint256)"]);
async function finishCurve(client: PublicClient, out: TokenCheck, token: Address, curve: Address, add: (c: string, s: Finding["severity"], m: string) => void, pair?: Address): Promise<TokenCheck> {
  // a curve priced in another token: the buyer first gets that token with ETH (its own Pons curve, or a Uniswap v3 pool)
  let prep: { from: Address; to: Address; data: Hex; value?: bigint }[] = [];
  let pairIn = BUY_WEI;
  if (pair) {
    const got = await acquire(client, pair).catch(() => null);
    if (!got) {
      add("CURVE_NOT_SIMULATED", "warn", `The curve is priced in another token (${pair}) that Heimdall could not buy in the simulation, so buying and selling were not tested.`);
      return out;
    }
    prep = [...got.calls, { from: BUYER, to: pair, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [curve, maxUint256] }) }];
    pairIn = got.amount;
  }
  const buyCall = { from: BUYER, to: curve, data: encodeFunctionData({ abi: PONS_CURVE, functionName: "buy", args: [pairIn, 0n, BUYER] }), value: pair ? 0n : BUY_WEI };
  let bought = 0n;
  try {
    const all = await sim(client, [...prep, buyCall]);
    const b = all[prep.length];
    if (!b || b.status !== "0x1") {
      out.buy = { ok: false, taxPct: null, reason: decodeRevert(b?.error?.data ?? b?.returnData, b?.error?.message) };
      add("BUY_FAILS", "deny", `Buying on the bonding curve reverts: ${out.buy.reason}.`);
      return out;
    }
    const tr = parseLogs(b.logs ?? []).transfers.filter((t) => t.asset.toLowerCase() === token.toLowerCase());
    const fromCurve = tr.filter((t) => t.from.toLowerCase() === curve.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
    bought = tr.filter((t) => t.to.toLowerCase() === BUYER.toLowerCase()).reduce((a, t) => a + t.amount, 0n) - tr.filter((t) => t.from.toLowerCase() === BUYER.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
    out.buy = { ok: true, taxPct: pct(fromCurve, bought > 0n ? bought : 0n) };
    if (bought <= 0n) { add("VANISHING_TOKEN", "deny", "The buy goes through, but the tokens do not stay in the buyer's wallet."); return out; }
    taxFinding(add, "BUY", out.buy.taxPct);
  } catch (e) {
    add("SIM_UNAVAILABLE", "warn", `Could not simulate: ${(e as Error).message.split("\n")[0]}.`);
    return out;
  }
  const approve = { from: BUYER, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [curve, maxUint256] }) };
  const sellCall = { from: BUYER, to: curve, data: encodeFunctionData({ abi: PONS_CURVE, functionName: "sell", args: [bought, 0n, BUYER] }) };
  const transferCall = { from: BUYER, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [STRANGER, bought] }) };
  const [sellRes, transferRes, deep] = await Promise.all([
    sim(client, [...prep, buyCall, approve, sellCall]).catch(() => null),
    sim(client, [...prep, buyCall, transferCall]).catch(() => null),
    pair ? Promise.resolve({ pulledBy: [] as Address[] }) : probeReceivedToken(client, { chainId: 4663, from: BUYER, to: curve, data: buyCall.data, value: BUY_WEI, overrides: { [BUYER]: { balance: toHex(10n ** 18n) } } }, token, bought),
  ]);
  const s = sellRes?.[prep.length + 2];
  if (s) {
    if (s.status !== "0x1") {
      out.sell = { ok: false, taxPct: null, reason: decodeRevert(s.error?.data ?? s.returnData, s.error?.message) };
      add("HONEYPOT", "deny", `Buying on the curve works but selling back reverts (${out.sell.reason}). This is a honeypot.`);
    } else {
      const toCurve = parseLogs(s.logs ?? []).transfers.filter((t) => t.asset.toLowerCase() === token.toLowerCase() && t.to.toLowerCase() === curve.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
      out.sell = { ok: true, taxPct: pct(bought, toCurve) };
      taxFinding(add, "SELL", out.sell.taxPct);
    }
  }
  const t = transferRes?.[prep.length + 1];
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
  return out;
}

/** Calls that give the simulated buyer some `pair` token for ETH, and how much arrives. */
async function acquire(client: PublicClient, pair: Address): Promise<{ calls: { from: Address; to: Address; data: Hex; value?: bigint }[]; amount: bigint } | null> {
  const launch = await detectLaunch(client, pair).catch(() => null);
  let call: { from: Address; to: Address; data: Hex; value?: bigint } | null = null;
  if (launch?.simulate === "ponsV2" && launch.curve && !launch.pairToken) {
    call = { from: BUYER, to: launch.curve, data: encodeFunctionData({ abi: PONS_CURVE, functionName: "buy", args: [BUY_WEI, 0n, BUYER] }), value: BUY_WEI };
  } else {
    const pool = await findPool(client, pair);
    if (pool) call = { from: BUYER, to: SWAP_ROUTER_02, data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: WETH, tokenOut: pair, fee: pool.fee, recipient: BUYER, amountIn: BUY_WEI, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] }), value: BUY_WEI };
  }
  if (!call) return null;
  const [r] = await sim(client, [call]);
  if (!r || r.status !== "0x1") return null;
  const amount = parseLogs(r.logs ?? []).transfers.filter((t) => t.asset.toLowerCase() === pair.toLowerCase() && t.to.toLowerCase() === BUYER.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
  return amount > 0n ? { calls: [call], amount } : null;
}

// ---- routes for the deeper tests: the same buys and sells as above, for any amount
const BIG_WEI = 10n ** 17n; // 0.1 ETH
function v3Route(token: Address, pool: { address: Address; fee: number }): Route {
  return {
    label: "Uniswap v3", sink: pool.address, bigWei: BIG_WEI,
    buy: (wei) => [{ from: DEEP_BUYER, to: SWAP_ROUTER_02, value: wei, data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: WETH, tokenOut: token, fee: pool.fee, recipient: DEEP_BUYER, amountIn: wei, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] }) }],
    sell: (amt) => [
      { from: DEEP_BUYER, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [SWAP_ROUTER_02, maxUint256] }) },
      { from: DEEP_BUYER, to: SWAP_ROUTER_02, data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: token, tokenOut: WETH, fee: pool.fee, recipient: DEEP_BUYER, amountIn: amt, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] }) },
    ],
  };
}
function v4Route(token: Address, p: V4Key): Route {
  const native = p.currency0.toLowerCase() === NATIVE.toLowerCase() || p.currency1.toLowerCase() === NATIVE.toLowerCase();
  const pairToken = native ? NATIVE : WETH;
  const key: V4Key = { currency0: p.currency0, currency1: p.currency1, fee: p.fee, tickSpacing: p.tickSpacing, hooks: p.hooks };
  const zfo = p.currency0.toLowerCase() === pairToken.toLowerCase();
  return {
    label: "Uniswap v4", sink: POOL_MANAGER, bigWei: BIG_WEI,
    buy: (wei) => [
      ...(native ? [] : [
        { from: DEEP_BUYER, to: WETH, data: encodeFunctionData({ abi: WETH_DEPOSIT, functionName: "deposit" }), value: wei },
        { from: DEEP_BUYER, to: WETH, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [PERMIT2, maxUint256] }) },
        { from: DEEP_BUYER, to: PERMIT2, data: encodeFunctionData({ abi: PERMIT2_APPROVE, functionName: "approve", args: [WETH, UNIVERSAL_ROUTER, (1n << 160n) - 1n, 281474976710655] }) },
      ]),
      { from: DEEP_BUYER, to: UNIVERSAL_ROUTER, data: v4SwapData(key, zfo, wei), value: native ? wei : 0n },
    ],
    sell: (amt) => [
      { from: DEEP_BUYER, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [PERMIT2, maxUint256] }) },
      { from: DEEP_BUYER, to: PERMIT2, data: encodeFunctionData({ abi: PERMIT2_APPROVE, functionName: "approve", args: [token, UNIVERSAL_ROUTER, (1n << 160n) - 1n, 281474976710655] }) },
      { from: DEEP_BUYER, to: UNIVERSAL_ROUTER, data: v4SwapData(key, !zfo, amt) },
    ],
  };
}
function curveRoute(token: Address, curve: Address): Route {
  return {
    label: "Pons bonding curve", sink: curve, bigWei: 0n, // a big buy can graduate the curve mid-trade: not a fair limit test
    buy: (wei) => [{ from: DEEP_BUYER, to: curve, value: wei, data: encodeFunctionData({ abi: PONS_CURVE, functionName: "buy", args: [wei, 0n, DEEP_BUYER] }) }],
    sell: (amt) => [
      { from: DEEP_BUYER, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [curve, maxUint256] }) },
      { from: DEEP_BUYER, to: curve, data: encodeFunctionData({ abi: PONS_CURVE, functionName: "sell", args: [amt, 0n, DEEP_BUYER] }) },
    ],
  };
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
