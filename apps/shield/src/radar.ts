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
  checkedAt: number;
}
export interface RadarSnapshot { generatedAt: number; block: string; launched24h: number; tokens: RadarToken[] }

interface Launch { token: Address; venue: string; block: bigint; market: Set<string> }

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
    out.set(token.toLowerCase(), { token, venue: "Pons", block: BigInt(l.blockNumber), market: new Set([curve.toLowerCase(), ...routers, POOL_MANAGER.toLowerCase()]) });
  }
  for (const l of v4) {
    const c0 = l.args.currency0!.toLowerCase(), c1 = l.args.currency1!.toLowerCase();
    const pair = c0 === NATIVE || c0 === WETH ? c0 : c1 === WETH ? c1 : null;
    if (!pair) continue;
    const token = getAddress(pair === c0 ? c1 : c0);
    const k = token.toLowerCase();
    if (out.has(k)) { out.get(k)!.market.add(POOL_MANAGER.toLowerCase()); continue; } // a Pons token graduating
    const hook = l.args.hooks!.toLowerCase();
    out.set(k, { token, venue: LAUNCHPAD_HOOKS[hook] ?? "Uniswap v4", block: l.blockNumber!, market: new Set([POOL_MANAGER.toLowerCase(), ...routers]) });
  }
  for (const l of v3) {
    const t0 = l.args.token0!.toLowerCase(), t1 = l.args.token1!.toLowerCase();
    if (t0 !== WETH && t1 !== WETH) continue;
    const token = getAddress(t0 === WETH ? t1 : t0);
    const k = token.toLowerCase();
    if (out.has(k)) { out.get(k)!.market.add(l.args.pool!.toLowerCase()); continue; }
    out.set(k, { token, venue: "Uniswap v3", block: l.blockNumber!, market: new Set([l.args.pool!.toLowerCase(), ...routers]) });
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

const SEV = { deny: 0, warn: 1, info: 2 } as const;
export function compact(r: TokenCheck): RadarCheck {
  return {
    verdict: r.verdict, riskScore: r.riskScore,
    flags: r.findings.filter((f) => f.severity !== "info").sort((a, b) => SEV[a.severity] - SEV[b.severity]).map((f) => f.code).slice(0, 4),
    holders: r.holders?.count ?? null, top10Pct: r.holders?.top10Pct ?? null, devSoldPct: r.holders?.devSoldPct ?? null,
    progressPct: r.launch?.graduated === false ? r.launch.progressPct : null, checkedAt: r.checkedAt,
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
}

/** Runs Token Check on the busiest tokens that have no fresh verdict, a few at a time, and fills them into the snapshot. */
export async function runChecks(snap: RadarSnapshot, d: Pick<RadarDeps, "check" | "putCheck" | "maxChecks">): Promise<number> {
  const todo = snap.tokens.filter((t) => !t.check).slice(0, d.maxChecks ?? 6);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const t = todo[next++]!;
      const r = await Promise.race([d.check(t.token), new Promise<null>((res) => setTimeout(() => res(null), 45_000))]).catch(() => null);
      if (r) { t.check = compact(r); done++; await d.putCheck(t.token, t.check).catch(() => {}); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
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
  if (all.size < 100 || stats.size === 0) throw new Error(`radar read incomplete: ${all.size} launches, ${stats.size} with activity`);
  const ranked = [...all.values()]
    .map((l) => ({ l, s: stats.get(l.token.toLowerCase()) }))
    .filter((x) => x.s && x.s.buyers.size > 0 && !TOKENS[x.l.token.toLowerCase()]) // known tokens (USDG, stocks) are not launches
    .sort((a, b) => b.s!.buyers.size - a.s!.buyers.size || b.s!.buys - a.s!.buys)
    .slice(0, d.size ?? 40);

  // earlier Token Check results are reused while fresh; new checks run after the snapshot is saved (runChecks)
  const cached = await Promise.all(ranked.map((x) => d.getCheck(x.l.token).catch(() => null)));
  const meta = await (d.client.multicall({ contracts: ranked.flatMap((x) => [{ address: x.l.token, abi: META, functionName: "symbol" }, { address: x.l.token, abi: META, functionName: "name" }]) as never, allowFailure: true }) as Promise<{ status: string; result?: string }[]>).catch(() => [] as { status: string; result?: string }[]);
  const text = (r?: { status: string; result?: string }) => (r?.status === "success" && typeof r.result === "string" ? r.result.slice(0, 40) : null);
  return {
    generatedAt: now, block: head.toString(), launched24h: all.size,
    tokens: ranked.map((x, i) => ({
      token: x.l.token, symbol: text(meta[i * 2]), name: text(meta[i * 2 + 1]), venue: x.l.venue,
      launchedAt: Math.round(now - (Number(head - x.l.block) / bps) * 1000),
      buyers1h: x.s!.buyers.size, buys1h: x.s!.buys, sells1h: x.s!.sells, check: cached[i] ?? null,
    })),
  };
}
