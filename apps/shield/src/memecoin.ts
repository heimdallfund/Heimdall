import { getAddress, parseAbi, type Address, type PublicClient } from "viem";
import { LAUNCHPAD_CONTRACTS, type Launch } from "./launchpad.js";
import { POOL_MANAGER, UNIVERSAL_ROUTER } from "./v4hooks.js";
import type { Finding } from "./types.js";
import { devHistoryFindings, isKlikPlatform, klikDevHistory, ponsDevHistory, type DevHistory } from "./devhistory.js";

/**
 * Who holds a token, read from the chain: its Transfer events (up to ~10M blocks back) give every address that ever
 * held it in that window, and balanceOf gives what each holds now. Pools, curves, lockers and burn addresses are not
 * holders. The dev wallet comes from the launchpad. Nothing here is estimated.
 */
export interface Holders {
  /** Addresses holding the token now, among those that moved it in the window. */
  count: number;
  top10Pct: number | null;
  top: { address: Address; pct: number }[];
  dev: Address | null;
  devPct: number | null;
  /** Share of what the dev ever received that the dev has sent on (sold or moved). */
  devSoldPct: number | null;
  /** Wallets that bought in the launch block and the two after it, and the share they hold now. */
  launchBuyers: { wallets: number; pct: number } | null;
  /** Other tokens the same dev launched on the same launchpad in about the last month. */
  devLaunches: number | null;
  /** "full" when the window reaches the token's mint, "recent" when the token is older than the window. */
  window: "full" | "recent";
  /** What happened to the dev's earlier launches (Pons). */
  devHistory?: DevHistory | null;
  /** Top holders who got their tokens sent from one wallet rather than buying them. */
  cluster?: { from: Address; wallets: number; pct: number; isDev: boolean } | null;
  /** Top holders that were early buyers of at least two other tokens that later graduated. */
  smart?: number | null;
}

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const NOT_HOLDERS = new Set([
  "0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead", POOL_MANAGER.toLowerCase(), UNIVERSAL_ROUTER.toLowerCase(),
  "0xcaf681a66d020601342297493863e78c959e5cb2", // Uniswap SwapRouter02
  "0x000000000022d473030f116ddee9f6b43ac78ba3", // Permit2
  ...LAUNCHPAD_CONTRACTS,
]);
const MAX_LOGS = 60_000;
const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);

interface Log { blockNumber: `0x${string}`; topics: `0x${string}`[]; data: `0x${string}` }

async function transferLogs(logs: PublicClient, token: Address, from: bigint, to: bigint, budget = { left: MAX_LOGS, until: Date.now() + 12_000 }, depth = 0): Promise<Log[] | null> {
  // a token this busy is established, not a fresh memecoin: give up rather than keep a buyer waiting
  if (budget.left <= 0 || Date.now() > budget.until) return null;
  try {
    const res = await logs.request({ method: "eth_getLogs", params: [{ address: token, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [TRANSFER] }] }) as Log[];
    budget.left -= res.length;
    return budget.left < 0 ? null : res;
  } catch (e) {
    if (to - from < 2_000n || !/exceed|limit|too many|range/i.test((e as Error).message)) return null;
    // the first two splits run side by side (at most four reads at once, under the public RPC's rate limit);
    // deeper ones go one after another so a busy token runs out of budget instead of flooding the RPC
    const mid = (from + to) / 2n;
    if (depth < 2) {
      const [a, b] = await Promise.all([transferLogs(logs, token, from, mid, budget, depth + 1), transferLogs(logs, token, mid + 1n, to, budget, depth + 1)]);
      return a && b ? [...a, ...b] : null;
    }
    const a = await transferLogs(logs, token, from, mid, budget, depth + 1);
    if (!a) return null;
    const b = await transferLogs(logs, token, mid + 1n, to, budget, depth + 1);
    return b ? [...a, ...b] : null;
  }
}

const word = (t: string) => getAddress(`0x${t.slice(26)}`);
const pct = (a: bigint, b: bigint) => (b > 0n ? Math.round(Number((a * 1_000_000n) / b) / 100) / 100 : 0);

export async function memecoinSignals(
  client: PublicClient, logs: PublicClient, token: Address,
  ctx: { supply: bigint | null; decimals: number | null; launch: Launch | null; pool: Address | null; smartCount?: (wallets: string[]) => Promise<number> },
): Promise<{ holders: Holders; findings: Finding[] } | null> {
  const supply = ctx.supply;
  if (!supply || supply === 0n) return null;
  const infra = new Set([...NOT_HOLDERS, token.toLowerCase()]);
  for (const a of [ctx.launch?.curve, ctx.launch?.pool, ctx.pool]) if (a) infra.add(a.toLowerCase());

  // the dev's track record depends only on who launched it: read it alongside the transfers, not after them
  const launcherP = ctx.launch?.launchpad === "Klik" && ctx.launch.dev ? isKlikPlatform(client, logs, ctx.launch.dev).catch(() => false) : Promise.resolve(false);
  const historyP = launcherP.then((launcher) => {
    const d = launcher ? null : ctx.launch?.dev ?? null;
    return d && ctx.launch?.launchpad === "Pons" ? ponsDevHistory(client, logs, d, token).catch(() => null)
      : d && ctx.launch?.launchpad === "Klik" ? klikDevHistory(client, logs, d, token).catch(() => null)
      : null;
  });
  historyP.catch(() => {});
  const latest = await logs.getBlockNumber();
  const start = latest > 9_900_000n ? latest - 9_900_000n : 0n;
  const all = await transferLogs(logs, token, start, latest);
  if (!all) return null; // too busy to read in one pass: an established token, not a fresh memecoin

  const minted = all.find((l) => /^0+$/.test(l.topics[1]!.slice(26)));
  const window: Holders["window"] = minted ? "full" : "recent";
  const seen = new Set<string>();
  const sentBy = new Map<string, Set<string>>(); // recipient -> wallets that sent it tokens directly
  const received = new Map<string, bigint>();
  const sent = new Map<string, bigint>();
  for (const l of all) {
    if (l.topics.length < 3) continue;
    const from = word(l.topics[1]!), to = word(l.topics[2]!);
    const amount = BigInt(l.data === "0x" ? 0 : l.data.slice(0, 66));
    seen.add(from); seen.add(to);
    received.set(to, (received.get(to) ?? 0n) + amount);
    if (!infra.has(from.toLowerCase()) && !infra.has(to.toLowerCase()) && !BURN.has(from.toLowerCase()) && from !== to) (sentBy.get(to) ?? sentBy.set(to, new Set()).get(to)!).add(from);
    // tokens burned are not "sold": only count what leaves for a live address
    if (!BURN.has(to.toLowerCase())) sent.set(from, (sent.get(from) ?? 0n) + amount);
  }
  const candidates = [...seen].filter((a) => !infra.has(a.toLowerCase()));
  const balances = new Map<string, bigint>();
  for (let i = 0; i < candidates.length; i += 400) {
    const chunk = candidates.slice(i, i + 400);
    const res = await client.multicall({ contracts: chunk.map((a) => ({ address: token, abi: ERC20, functionName: "balanceOf", args: [a as Address] })), allowFailure: true });
    chunk.forEach((a, j) => { const r = res[j]; if (r?.status === "success" && (r.result as bigint) > 0n) balances.set(a, r.result as bigint); });
  }
  const ranked = [...balances.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
  const top10 = ranked.slice(0, 10).reduce((s, [, v]) => s + v, 0n);

  // a launchpad's own launcher account is not a dev: its "sales" are the platform's, and it has no history of its own
  const launcher = await launcherP;
  const dev = launcher ? null : ctx.launch?.dev ?? null;
  const devBal = dev ? (balances.get(dev) ?? (await client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [dev] }).catch(() => 0n))) : null;
  const devIn = dev ? received.get(dev) ?? 0n : 0n;
  const devOut = dev ? sent.get(dev) ?? 0n : 0n;

  // wallets the curve or pool paid out to in the launch block and the next two
  let launchBuyers: Holders["launchBuyers"] = null;
  if (minted) {
    const b0 = BigInt(minted.blockNumber);
    const early = new Set<string>();
    for (const l of all) {
      if (BigInt(l.blockNumber) > b0 + 2n) break;
      if (l.topics.length < 3) continue;
      const from = word(l.topics[1]!), to = word(l.topics[2]!);
      if (infra.has(from.toLowerCase()) && !infra.has(to.toLowerCase()) && to !== dev) early.add(to);
    }
    const held = [...early].reduce((s, a) => s + (balances.get(a) ?? 0n), 0n);
    launchBuyers = { wallets: early.size, pct: pct(held, supply) };
  }
  const [devHistory, smart] = await Promise.all([
    historyP,
    ctx.smartCount ? ctx.smartCount(ranked.slice(0, 30).map(([a]) => a.toLowerCase()).filter((a) => a !== dev?.toLowerCase())).catch(() => null) : Promise.resolve(null),
  ]);
  const devLaunches = devHistory ? devHistory.launches : null;

  // a wallet that sent tokens to several of the top holders: a dev or insider splitting a bag, not separate buyers
  const fanout = new Map<string, string[]>();
  for (const [holder] of ranked.slice(0, 20)) for (const f of sentBy.get(holder) ?? []) (fanout.get(f) ?? fanout.set(f, []).get(f)!).push(holder);
  const biggestFan = [...fanout.entries()].map(([f, hs]) => ({ f, hs, held: hs.reduce((a, h) => a + (balances.get(h) ?? 0n), 0n) })).sort((a, b) => (b.held > a.held ? 1 : -1))[0];
  const cluster = biggestFan && biggestFan.hs.length >= 3 ? { from: getAddress(biggestFan.f), wallets: biggestFan.hs.length, pct: pct(biggestFan.held, supply), isDev: !!dev && biggestFan.f.toLowerCase() === dev.toLowerCase() } : null;

  const holders: Holders = {
    count: balances.size,
    top10Pct: pct(top10, supply),
    top: ranked.slice(0, 10).map(([address, v]) => ({ address: address as Address, pct: pct(v, supply) })),
    dev, devPct: devBal === null ? null : pct(devBal, supply),
    devSoldPct: dev && devIn > 0n ? Math.min(100, pct(devOut, devIn)) : null,
    launchBuyers, devLaunches, window, devHistory, cluster, smart,
  };

  const F: Finding[] = [];
  const add = (code: string, severity: Finding["severity"], message: string) => F.push({ code, severity, message });
  const biggest = ranked[0];
  if (biggest && biggest[0] !== dev && pct(biggest[1], supply) >= 20) add("WHALE_HOLDER", "warn", `One wallet (${biggest[0]}) holds ${pct(biggest[1], supply).toFixed(1)}% of the supply and can crash the price by selling.`);
  if (holders.top10Pct !== null && holders.top10Pct >= 60) add("HOLDERS_CONCENTRATED", "warn", `The 10 biggest holders own ${holders.top10Pct.toFixed(1)}% of the supply (pools and the curve not counted).`);
  else if (holders.top10Pct !== null && holders.top10Pct >= 35) add("HOLDERS_CONCENTRATED", "info", `The 10 biggest holders own ${holders.top10Pct.toFixed(1)}% of the supply.`);
  if (holders.devPct !== null && dev) {
    if (holders.devPct >= 15) add("DEV_HOLDS_LARGE", "warn", `The dev wallet still holds ${holders.devPct.toFixed(1)}% of the supply.`);
    else if (holders.devPct >= 5) add("DEV_HOLDS", "info", `The dev wallet holds ${holders.devPct.toFixed(1)}% of the supply.`);
  }
  if (holders.devSoldPct !== null && holders.devSoldPct >= 50 && devIn > supply / 100n) add("DEV_SOLD", "warn", `The dev has sold or moved ${holders.devSoldPct.toFixed(0)}% of the tokens they got (burns not counted).`);
  if (launchBuyers && launchBuyers.wallets >= 5 && launchBuyers.pct >= 15) add("BUNDLED_LAUNCH", "warn", `${launchBuyers.wallets} wallets bought in the first blocks and still hold ${launchBuyers.pct.toFixed(1)}%: a sign of a bundled or sniped launch.`);
  if (devHistory) F.push(...devHistoryFindings(devHistory));
  if (cluster && cluster.pct >= 10) add("HOLDER_CLUSTER", cluster.pct >= 25 || cluster.isDev ? "warn" : "info", `${cluster.wallets} of the top holders got their tokens sent from ${cluster.isDev ? "the dev's wallet" : `one wallet (${cluster.from})`} instead of buying; together they hold ${cluster.pct.toFixed(1)}% of the supply.`);
  if (smart && smart >= 2) add("SMART_MONEY", "info", `${smart} of the top holders were early buyers in at least two other tokens that later graduated.`);
  if (window === "full" && holders.count < 20) add("FEW_HOLDERS", "info", holders.count === 0 ? "No wallet holds it yet: nobody has bought." : `Only ${holders.count} wallet${holders.count === 1 ? "" : "s"} hold${holders.count === 1 ? "s" : ""} it.`);
  return { holders, findings: F };
}
