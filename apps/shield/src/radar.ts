import { getAddress, parseAbi, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { LAUNCHPAD_HOOKS } from "./launchpad.js";
import { POOL_MANAGER, UNIVERSAL_ROUTER } from "./v4hooks.js";
import type { TokenCheck } from "./tokencheck.js";
import { TOKENS } from "./registry.js";

/**
 * Launch Radar: every token launched on Robinhood Chain in the last 24 hours (Pons bonding curves, new Uniswap v4 pools
 * against ETH, new Uniswap v3 pools against WETH), ranked by how many different wallets bought it in the last hour,
 * with Heimdall's Token Check verdict for the busiest ones. Every number is counted from onchain events; nothing is
 * a prediction.
 */

const PONS_FACTORY: Address = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const PONS_LAUNCH = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
const V3_FACTORY: Address = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const NATIVE = "0x0000000000000000000000000000000000000000";
const SWAP_ROUTER_02 = "0xcaf681a66d020601342297493863e78c959e5cb2";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const INIT = parseAbiItem("event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)");
const POOL_CREATED = parseAbiItem("event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)");
const ETH_FEED: Address = "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9";
const PAIR = parseAbi(["function pairToken() view returns (address)"]);
const FEED = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)"]);
const META = parseAbi(["function symbol() view returns (string)", "function name() view returns (string)"]);
const BLOCKS_PER_SECOND_FALLBACK = 9.5;

export interface RadarToken {
  token: Address;
  symbol: string | null;
  name: string | null;
  /** Where it trades: "Pons", "Klik", "Uniswap v4", "Uniswap v3"… */
  venue: string;
  launchedAt: number;
  /** Counted from Transfer events over the last hour. */
  buyers1h: number;
  buys1h: number;
  sells1h: number;
  /** ETH that went in (buys) and came out (sells) in the last hour; null when the trade events could not be read. */
  buyEth1h: number | null;
  sellEth1h: number | null;
  /** Heimdall's Token Check, when it has run; null until then. */
  check: RadarCheck | null;
}
export interface RadarCheck {
  verdict: TokenCheck["verdict"];
  riskScore: number;
  /** The worst findings, codes only, most severe first. */
  flags: string[];
  holders: number | null;
  top10Pct: number | null;
  devSoldPct: number | null;
  progressPct: number | null;
  /** Top holders who were early in at least two tokens that later graduated. */
  smart?: number | null;
  /** The dev's earlier launches: how many, and how many they dumped. */
  devLaunches?: number | null;
  devDumped?: number | null;
  checkedAt: number;
}
export interface RadarSnapshot { generatedAt: number; block: string; launched24h: number; ethUsd: number | null; tokens: RadarToken[] }

interface Launch { token: Address; venue: string; block: bigint; market: Set<string>; curve?: string; v4?: { id: Hex; eth: 0 | 1 }; v3?: { pool: string; eth: 0 | 1 } }

const hex = (n: bigint) => `0x${n.toString(16)}`;
const topicAddr = (t: string) => getAddress(`0x${t.slice(26)}`);

/** Tokens launched in the window, with the addresses that make up their market (curve, pool, pool manager, routers). */
async function launches(logs: PublicClient, from: bigint, to: bigint): Promise<Map<string, Launch>> {
  const out = new Map<string, Launch>();
  const routers = [UNIVERSAL_ROUTER.toLowerCase(), SWAP_ROUTER_02];
  const [pons, v4, v3] = await Promise.all([
    logs.request({ method: "eth_getLogs", params: [{ address: PONS_FACTORY, fromBlock: hex(from), toBlock: hex(to), topics: [PONS_LAUNCH] }] } as never).catch(() => []) as Promise<{ topics: Hex[]; blockNumber: Hex }[]>,
    logs.getLogs({ address: POOL_MANAGER, event: INIT, fromBlock: from, toBlock: to }).catch(() => []),
    logs.getLogs({ address: V3_FACTORY, event: POOL_CREATED, fromBlock: from, toBlock: to }).catch(() => []),
  ]);
  for (const l of pons) {
    const token = topicAddr(l.topics[1]!), curve = topicAddr(l.topics[2]!);
    out.set(token.toLowerCase(), { token, venue: "Pons", block: BigInt(l.blockNumber), market: new Set([curve.toLowerCase(), ...routers, POOL_MANAGER.toLowerCase()]), curve: curve.toLowerCase() });
  }
  for (const l of v4) {
    const c0 = l.args.currency0!.toLowerCase(), c1 = l.args.currency1!.toLowerCase();
    const pair = c0 === NATIVE || c0 === WETH ? c0 : c1 === WETH ? c1 : null;
    if (!pair) continue;
    const token = getAddress(pair === c0 ? c1 : c0);
    const k = token.toLowerCase();
    const v4 = { id: l.args.id!, eth: (pair === c0 ? 0 : 1) as 0 | 1 };
    if (out.has(k)) { const x = out.get(k)!; x.market.add(POOL_MANAGER.toLowerCase()); x.v4 ??= v4; continue; } // a Pons token graduating
    const hook = l.args.hooks!.toLowerCase();
    out.set(k, { token, venue: LAUNCHPAD_HOOKS[hook] ?? "Uniswap v4", block: l.blockNumber!, market: new Set([POOL_MANAGER.toLowerCase(), ...routers]), v4 });
  }
  for (const l of v3) {
    const t0 = l.args.token0!.toLowerCase(), t1 = l.args.token1!.toLowerCase();
    if (t0 !== WETH && t1 !== WETH) continue;
    const token = getAddress(t0 === WETH ? t1 : t0);
    const k = token.toLowerCase();
    const v3 = { pool: l.args.pool!.toLowerCase(), eth: (t0 === WETH ? 0 : 1) as 0 | 1 };
    if (out.has(k)) { const x = out.get(k)!; x.market.add(v3.pool); x.v3 ??= v3; continue; }
    out.set(k, { token, venue: "Uniswap v3", block: l.blockNumber!, market: new Set([v3.pool, ...routers]), v3 });
  }
  return out;
}

/** Buys and sells in the window: a transfer out of the token's market to a wallet is a buy, the reverse a sell. */
async function activity(logs: PublicClient, all: Map<string, Launch>, from: bigint, to: bigint) {
  const stats = new Map<string, { buyers: Set<string>; buys: number; sells: number }>();
  const tokens = [...all.values()].map((l) => l.token);
  const batches: Address[][] = [];
  for (let i = 0; i < tokens.length; i += 50) batches.push(tokens.slice(i, i + 50));
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const b = batches[next++]!;
      const res = await logs.request({ method: "eth_getLogs", params: [{ address: b, fromBlock: hex(from), toBlock: hex(to), topics: [TRANSFER] }] } as never)
        .catch(() => new Promise((r) => setTimeout(r, 500)).then(() => logs.request({ method: "eth_getLogs", params: [{ address: b, fromBlock: hex(from), toBlock: hex(to), topics: [TRANSFER] }] } as never)))
        .catch(() => []) as { address: Address; topics: Hex[] }[];
      for (const l of res) {
        if (l.topics.length !== 3) continue;
        const k = l.address.toLowerCase();
        const m = all.get(k)?.market;
        if (!m) continue;
        const f = `0x${l.topics[1]!.slice(26)}`.toLowerCase(), t = `0x${l.topics[2]!.slice(26)}`.toLowerCase();
        const s = stats.get(k) ?? { buyers: new Set<string>(), buys: 0, sells: 0 };
        if (m.has(f) && !m.has(t) && t !== NATIVE) { s.buys++; s.buyers.add(t); }
        else if (!m.has(f) && m.has(t) && f !== NATIVE) s.sells++;
        stats.set(k, s);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return stats;
}

const PONS_BUY = "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455";
const PONS_SELL = "0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df";
const SWAP_V4 = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";
const SWAP_V3 = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
const int = (w: string) => { const v = BigInt(`0x${w}`); return v >= 1n << 255n ? v - (1n << 256n) : v; };
const words = (d: Hex) => d.slice(2).match(/.{64}/g) ?? [];

/**
 * ETH traded in the window, from the trade events themselves: Pons curve Buy and Sell events (ETH in and out), and the
 * ETH side of every Uniswap v4 and v3 swap. A buy is ETH going into the market, a sell ETH coming out.
 */
async function volume(logs: PublicClient, list: Launch[], from: bigint, to: bigint) {
  const vol = new Map<string, { buy: bigint; sell: bigint }>();
  const add = (k: string, buy: bigint, sell: bigint) => { const v = vol.get(k) ?? { buy: 0n, sell: 0n }; v.buy += buy; v.sell += sell; vol.set(k, v); };
  const range = { fromBlock: hex(from), toBlock: hex(to) };
  const q = (filter: object) => logs.request({ method: "eth_getLogs", params: [{ ...filter, ...range }] } as never).catch(() => []) as Promise<{ address: Address; topics: Hex[]; data: Hex }[]>;
  const byCurve = new Map(list.filter((l) => l.curve).map((l) => [l.curve!, l.token.toLowerCase()]));
  const byV4 = new Map(list.filter((l) => l.v4).map((l) => [l.v4!.id.toLowerCase(), l]));
  const byV3 = new Map(list.filter((l) => l.v3).map((l) => [l.v3!.pool, l]));
  const [curves, v4, v3] = await Promise.all([
    byCurve.size ? q({ address: [...byCurve.keys()], topics: [[PONS_BUY, PONS_SELL]] }) : Promise.resolve([]),
    byV4.size ? q({ address: POOL_MANAGER, topics: [SWAP_V4, [...byV4.keys()]] }) : Promise.resolve([]),
    byV3.size ? q({ address: [...byV3.keys()], topics: [SWAP_V3] }) : Promise.resolve([]),
  ]);
  for (const l of curves) {
    const k = byCurve.get(l.address.toLowerCase()); const w = words(l.data);
    if (!k || w.length < 2) continue;
    if (l.topics[0] === PONS_BUY) add(k, BigInt(`0x${w[0]}`), 0n); else add(k, 0n, BigInt(`0x${w[1]}`));
  }
  for (const l of v4) {
    const x = byV4.get(l.topics[1]!.toLowerCase()); const w = words(l.data);
    if (!x || w.length < 2) continue;
    // v4 amounts are the swapper's deltas: negative is paid in, positive is received
    const eth = int(w[x.v4!.eth]!);
    if (eth < 0n) add(x.token.toLowerCase(), -eth, 0n); else add(x.token.toLowerCase(), 0n, eth);
  }
  for (const l of v3) {
    const x = byV3.get(l.address.toLowerCase()); const w = words(l.data);
    if (!x || w.length < 2) continue;
    // v3 amounts are the pool's deltas: positive is paid into the pool
    const eth = int(w[x.v3!.eth]!);
    if (eth > 0n) add(x.token.toLowerCase(), eth, 0n); else add(x.token.toLowerCase(), 0n, -eth);
  }
  return vol;
}

const SEV = { deny: 0, warn: 1, info: 2 } as const;
export function compact(r: TokenCheck): RadarCheck {
  return {
    verdict: r.verdict, riskScore: r.riskScore,
    flags: r.findings.filter((f) => f.severity !== "info").sort((a, b) => SEV[a.severity] - SEV[b.severity]).map((f) => f.code).slice(0, 4),
    holders: r.holders?.count ?? null, top10Pct: r.holders?.top10Pct ?? null, devSoldPct: r.holders?.devSoldPct ?? null,
    progressPct: r.launch?.graduated === false ? r.launch.progressPct : null, checkedAt: r.checkedAt,
    smart: r.holders?.smart ?? null, devLaunches: r.holders?.devHistory?.launches ?? null, devDumped: r.holders?.devHistory?.dumped ?? null,
  };
}

export interface RadarDeps {
  client: PublicClient;
  logs: PublicClient;
  check: (token: Address) => Promise<TokenCheck>;
  getCheck: (token: Address) => Promise<RadarCheck | null>;
  putCheck: (token: Address, c: RadarCheck) => Promise<void>;
  now?: number;
  /** How many tokens to check per refresh, and how many to show. */
  maxChecks?: number;
  size?: number;
  /** Fewer launches than this in 24 hours means the read failed (tests set 0). */
  minLaunches?: number;
}

/** Runs Token Check on the busiest tokens that have no fresh verdict, a few at a time, and fills them into the snapshot. */
export async function runChecks(snap: RadarSnapshot, d: Pick<RadarDeps, "check" | "putCheck" | "maxChecks">): Promise<number> {
  const todo = snap.tokens.filter((t) => !t.check).slice(0, d.maxChecks ?? 8);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const t = todo[next++]!;
      const r = await Promise.race([d.check(t.token), new Promise<null>((res) => setTimeout(() => res(null), 45_000))]).catch(() => null);
      if (r) {
        t.check = compact(r); done++;
        // a check that could not reach the chain is shown once but not kept
        if (!r.findings.some((f) => f.code === "SIM_UNAVAILABLE")) await d.putCheck(t.token, t.check).catch(() => {});
      }
    }
  };
  await Promise.all([worker(), worker()]); // two at a time: the radar must not slow down users' own checks
  return done;
}

export async function buildRadar(d: RadarDeps): Promise<RadarSnapshot> {
  const now = d.now ?? Date.now();
  const head = await d.logs.getBlockNumber();
  const [hb, ob] = await Promise.all([d.logs.getBlock({ blockNumber: head }), d.logs.getBlock({ blockNumber: head - 100_000n })]).catch(() => [null, null]);
  const bps = hb && ob ? 100_000 / Math.max(1, Number(hb.timestamp - ob.timestamp)) : BLOCKS_PER_SECOND_FALLBACK;
  const day = BigInt(Math.round(bps * 86_400)), hour = BigInt(Math.round(bps * 3_600));
  const all = await launches(d.logs, head - day, head);
  const stats = await activity(d.logs, all, head - hour, head);
  // an empty hour on a chain with hundreds of launches a day means the log queries failed: keep the last snapshot
  if (all.size < (d.minLaunches ?? 100) || stats.size === 0) throw new Error(`radar read incomplete: ${all.size} launches, ${stats.size} with activity`);
  const ranked = [...all.values()]
    .map((l) => ({ l, s: stats.get(l.token.toLowerCase()) }))
    .filter((x) => x.s && x.s.buyers.size > 0 && !TOKENS[x.l.token.toLowerCase()]) // known tokens (USDG, stocks) are not launches
    .sort((a, b) => b.s!.buyers.size - a.s!.buyers.size || b.s!.buys - a.s!.buys)
    .slice(0, d.size ?? 40);

  // a Pons curve priced in another token reports amounts of that token, not ETH: no ETH volume for those
  const withCurve = ranked.filter((x) => x.l.curve);
  const pairs = await ((async () => d.client.multicall({ contracts: withCurve.map((x) => ({ address: x.l.curve as Address, abi: PAIR, functionName: "pairToken" })) as never, allowFailure: true }))() as Promise<{ status: string; result?: string }[]>).catch(() => [] as { status: string; result?: string }[]);
  const noEth = new Set(withCurve.filter((_, i) => pairs[i]?.status === "success" && !/^0x0{40}$/i.test(String(pairs[i]!.result))).map((x) => x.l.token.toLowerCase()));
  for (const x of withCurve) if (noEth.has(x.l.token.toLowerCase())) x.l.curve = undefined;
  const [vol, ethUsd] = await Promise.all([
    volume(d.logs, ranked.map((x) => x.l), head - hour, head).catch(() => null),
    (async () => d.client.readContract({ address: ETH_FEED, abi: FEED, functionName: "latestRoundData" }))().then((r) => Number(r[1]) / 1e8).catch(() => null),
  ]);
  // earlier Token Check results are reused while fresh; new checks run after the snapshot is saved (runChecks)
  const cached = await Promise.all(ranked.map((x) => d.getCheck(x.l.token).catch(() => null)));
  const meta = await (d.client.multicall({ contracts: ranked.flatMap((x) => [{ address: x.l.token, abi: META, functionName: "symbol" }, { address: x.l.token, abi: META, functionName: "name" }]) as never, allowFailure: true }) as Promise<{ status: string; result?: string }[]>).catch(() => [] as { status: string; result?: string }[]);
  const text = (r?: { status: string; result?: string }) => (r?.status === "success" && typeof r.result === "string" ? r.result.slice(0, 40) : null);
  return {
    generatedAt: now, block: head.toString(), launched24h: all.size, ethUsd,
    tokens: ranked.map((x, i) => ({
      token: x.l.token, symbol: text(meta[i * 2]), name: text(meta[i * 2 + 1]), venue: x.l.venue,
      launchedAt: Math.round(now - (Number(head - x.l.block) / bps) * 1000),
      buyers1h: x.s!.buyers.size, buys1h: x.s!.buys, sells1h: x.s!.sells,
      buyEth1h: vol && !noEth.has(x.l.token.toLowerCase()) ? Number(vol.get(x.l.token.toLowerCase())?.buy ?? 0n) / 1e18 : null,
      sellEth1h: vol && !noEth.has(x.l.token.toLowerCase()) ? Number(vol.get(x.l.token.toLowerCase())?.sell ?? 0n) / 1e18 : null,
      check: cached[i] ?? null,
    })),
  };
}
