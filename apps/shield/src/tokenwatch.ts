import { createHash } from "node:crypto";
import { decodeAbiParameters, getAddress, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import type { CounterStore } from "./store.js";
import type { Sender, PushSubscriptionJSON } from "./watch.js";
import type { TokenCheck } from "./tokencheck.js";
import { POOL_MANAGER, UNIVERSAL_ROUTER } from "./v4hooks.js";

/**
 * Token Watch: browser push notifications about a token, read from the chain every couple of minutes:
 *   - the dev sells or moves their tokens
 *   - any wallet sells a large share of the supply at once
 *   - liquidity is taken out of the pool
 *   - Token Check gets worse (for example the owner raised the tax or selling stopped working), re-run every 15 minutes
 *   - the token graduates from its bonding curve
 * Only the token address and the push address the browser hands out are stored; no account, no email.
 */

export interface TokenMeta {
  symbol: string | null;
  supply: string | null;
  dev: Address | null;
  /** Curve, pool, pool manager and routers: a transfer into one of them is a sell. */
  market: string[];
  v3Pool: Address | null;
  v4PoolId: Hex | null;
  graduated: boolean | null;
}
interface StoredSub extends PushSubscriptionJSON { tokens: string[]; at: number }
interface Verdict { verdict: TokenCheck["verdict"]; codes: string[]; sellTax: number | null; at: number }
export interface TokenAlert { kind: "dev_sold" | "dev_moved" | "whale_sold" | "liquidity_removed" | "verdict_worse" | "graduated"; title: string; body: string }

const FOREVER = 400 * 86_400;
const MAX_PER_SUB = 10;
const MAX_TOKENS = 5_000;
const RECHECK_MS = 15 * 60_000;
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MODIFY_V4 = "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec";
const BURN_V3 = "0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c";
const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);
const ROUTERS = [UNIVERSAL_ROUTER.toLowerCase(), "0xcaf681a66d020601342297493863e78c959e5cb2"];
const w = (a: string) => a.toLowerCase();
const subId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 20);
const SEV = { ALLOW: 0, WARN: 1, DENY: 2 } as const;

export function metaFrom(r: TokenCheck): TokenMeta {
  const market = new Set<string>(ROUTERS);
  if (r.launch?.curve) market.add(w(r.launch.curve));
  if (r.pool?.version === 3) market.add(w(r.pool.address));
  if (r.pool?.version === 4 || r.launch?.graduated) market.add(w(POOL_MANAGER));
  return {
    symbol: r.symbol, supply: r.totalSupply, dev: r.launch?.dev ?? null, market: [...market],
    v3Pool: r.pool?.version === 3 ? getAddress(r.pool.address) : null,
    v4PoolId: r.pool?.version === 4 ? (r.pool.address as Hex) : null,
    graduated: r.launch ? r.launch.graduated : null,
  };
}
const verdictOf = (r: TokenCheck): Verdict => ({ verdict: r.verdict, codes: r.findings.filter((f) => f.severity !== "info").map((f) => f.code), sellTax: r.sell?.taxPct ?? null, at: Date.now() });

export async function subscribeToken(store: CounterStore, token: string, sub: PushSubscriptionJSON, check: () => Promise<TokenCheck>) {
  const id = subId(sub.endpoint);
  const prev = JSON.parse((await store.fetch(`twatch:sub:${id}`)) ?? "null") as StoredSub | null;
  const tokens = [...new Set([...(prev?.tokens ?? []), w(token)])];
  if (tokens.length > MAX_PER_SUB) return { ok: false as const, error: "too_many_tokens", message: `One browser can watch up to ${MAX_PER_SUB} tokens.` };
  const all = await store.members("twatch:tokens");
  if (!all.includes(w(token)) && all.length >= MAX_TOKENS) return { ok: false as const, error: "full" };
  if (!(await store.fetch(`twatch:meta:${w(token)}`))) {
    const r = await check();
    await store.put(`twatch:meta:${w(token)}`, JSON.stringify(metaFrom(r)), FOREVER);
    await store.put(`twatch:verdict:${w(token)}`, JSON.stringify(verdictOf(r)), FOREVER);
  }
  await store.put(`twatch:sub:${id}`, JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys, tokens, at: prev?.at ?? Date.now() } satisfies StoredSub), FOREVER);
  await store.addMember(`twatch:tok:${w(token)}`, id);
  await store.addMember("twatch:tokens", w(token));
  return { ok: true as const, watching: tokens };
}

export async function unsubscribeToken(store: CounterStore, endpoint: string, token?: string) {
  const id = subId(endpoint);
  const prev = JSON.parse((await store.fetch(`twatch:sub:${id}`)) ?? "null") as StoredSub | null;
  if (!prev) return { ok: true, watching: [] as string[] };
  const drop = token ? [w(token)] : prev.tokens;
  for (const t of drop) {
    await store.removeMember(`twatch:tok:${t}`, id);
    if (!(await store.members(`twatch:tok:${t}`)).length) {
      await store.removeMember("twatch:tokens", t);
      for (const k of ["meta", "verdict", "last"]) await store.remove(`twatch:${k}:${t}`);
    }
  }
  const left = prev.tokens.filter((t) => !drop.includes(t));
  if (left.length) await store.put(`twatch:sub:${id}`, JSON.stringify({ ...prev, tokens: left }), FOREVER);
  else await store.remove(`twatch:sub:${id}`);
  return { ok: true, watching: left };
}

const pctOf = (x: bigint, supply: bigint) => (supply > 0n ? Number((x * 10_000n) / supply) / 100 : 0);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** What happened to one token between two blocks, from its Transfer events and its pool's liquidity events. */
export async function tokenEvents(logs: PublicClient, client: PublicClient, token: Address, meta: TokenMeta, from: bigint, to: bigint): Promise<TokenAlert[]> {
  const A: TokenAlert[] = [];
  const name = meta.symbol ?? short(token);
  const supply = meta.supply ? BigInt(meta.supply) : 0n;
  const market = new Set(meta.market);
  const range = { fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` };
  const transfers = await logs.request({ method: "eth_getLogs", params: [{ address: token, topics: [TRANSFER], ...range }] } as never) as { topics: Hex[]; data: Hex }[];
  const sold = new Map<string, bigint>();
  let devSold = 0n, devMoved = 0n;
  const dev = meta.dev ? w(meta.dev) : null;
  for (const l of transfers) {
    if (l.topics.length !== 3) continue;
    const f = `0x${l.topics[1]!.slice(26)}`, t = `0x${l.topics[2]!.slice(26)}`;
    const amount = l.data && l.data !== "0x" ? BigInt(l.data.slice(0, 66)) : 0n;
    const toMarket = market.has(t), fromMarket = market.has(f);
    if (f === dev && !BURN.has(t)) { if (toMarket) devSold += amount; else devMoved += amount; }
    if (toMarket && !fromMarket && !BURN.has(f)) sold.set(f, (sold.get(f) ?? 0n) + amount);
  }
  if (supply > 0n) {
    if (pctOf(devSold, supply) >= 0.5) A.push({ kind: "dev_sold", title: `${name}: the dev sold ${pctOf(devSold, supply).toFixed(1)}% of the supply`, body: `The wallet that launched ${name} just sold. Tap to see the holders and the latest check.` });
    if (pctOf(devMoved, supply) >= 0.5) A.push({ kind: "dev_moved", title: `${name}: the dev moved ${pctOf(devMoved, supply).toFixed(1)}% of the supply`, body: "Moved to another wallet, often the step before selling from a fresh address." });
    const whale = [...sold.entries()].filter(([a]) => a !== dev).sort((a, b) => (b[1] > a[1] ? 1 : -1))[0];
    if (whale && pctOf(whale[1], supply) >= 2) A.push({ kind: "whale_sold", title: `${name}: one wallet sold ${pctOf(whale[1], supply).toFixed(1)}% of the supply`, body: `${short(whale[0])} sold in the last few minutes.` });
  }
  // liquidity taken out of the pool
  if (meta.v4PoolId) {
    const mods = await logs.request({ method: "eth_getLogs", params: [{ address: POOL_MANAGER, topics: [MODIFY_V4, meta.v4PoolId], ...range }] } as never).catch(() => []) as { data: Hex }[];
    const removed = mods.map((m) => decodeAbiParameters([{ type: "int24" }, { type: "int24" }, { type: "int256" }, { type: "bytes32" }], m.data)[2]).filter((d) => d < 0n).reduce((a, d) => a - d, 0n);
    if (removed > 0n) {
      const left = await client.readContract({ address: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b", abi: parseAbi(["function getLiquidity(bytes32) view returns (uint128)"]), functionName: "getLiquidity", args: [meta.v4PoolId] }).catch(() => null);
      const share = left !== null ? Math.round(Number((removed * 100n) / (removed + left))) : null;
      if (share === null || share >= 10) A.push({ kind: "liquidity_removed", title: `${name}: liquidity removed${share !== null ? ` (${share}% of the pool)` : ""}`, body: share !== null && share >= 90 ? "Almost all liquidity is gone: selling may no longer be possible. This is how a rug pull looks." : "Selling now moves the price more. Tap for the latest check." });
    }
  } else if (meta.v3Pool) {
    const burns = await logs.request({ method: "eth_getLogs", params: [{ address: meta.v3Pool, topics: [BURN_V3], ...range }] } as never).catch(() => []) as { data: Hex }[];
    const removed = burns.reduce((a, b) => a + BigInt(b.data.slice(0, 66)), 0n);
    if (removed > 0n) {
      const left = await client.readContract({ address: meta.v3Pool, abi: parseAbi(["function liquidity() view returns (uint128)"]), functionName: "liquidity" }).catch(() => null);
      const share = left !== null ? Math.round(Number((removed * 100n) / (removed + left))) : null;
      if (share === null || share >= 10) A.push({ kind: "liquidity_removed", title: `${name}: liquidity removed${share !== null ? ` (${share}% of the pool)` : ""}`, body: share !== null && share >= 90 ? "Almost all liquidity is gone: selling may no longer be possible. This is how a rug pull looks." : "Selling now moves the price more. Tap for the latest check." });
    }
  }
  return A;
}

/** Compares a fresh Token Check with the last one: alerts when it got worse, or when the token graduated. */
export function verdictChange(prev: Verdict | null, r: TokenCheck, meta: TokenMeta): { alerts: TokenAlert[]; meta: TokenMeta } {
  const A: TokenAlert[] = [];
  const name = meta.symbol ?? short(r.token);
  const now = verdictOf(r);
  if (prev) {
    const fresh = now.codes.filter((c) => !prev.codes.includes(c));
    const deny = r.findings.find((f) => f.severity === "deny" && fresh.includes(f.code));
    if (SEV[now.verdict] > SEV[prev.verdict] || deny) {
      const f = deny ?? r.findings.find((x) => fresh.includes(x.code)) ?? r.findings.find((x) => x.severity !== "info");
      A.push({ kind: "verdict_worse", title: `${name}: Token Check now says ${now.verdict}`, body: f ? f.message.slice(0, 160) : `It was ${prev.verdict} before.` });
    } else if (prev.sellTax !== null && now.sellTax !== null && now.sellTax - prev.sellTax >= 5) {
      A.push({ kind: "verdict_worse", title: `${name}: the sell tax went up to ${now.sellTax.toFixed(1)}%`, body: `It was ${prev.sellTax.toFixed(1)}% at the last check.` });
    }
  }
  const next = metaFrom(r);
  if (meta.graduated === false && next.graduated === true) A.push({ kind: "graduated", title: `${name} graduated to Uniswap`, body: "It left its bonding curve; it now trades in a Uniswap pool. Liquidity alerts now cover that pool." });
  return { alerts: A, meta: { ...next, dev: next.dev ?? meta.dev } };
}

export interface TokenWatchDeps {
  logs: PublicClient;
  client: PublicClient;
  check: (token: Address) => Promise<TokenCheck>;
  send: Sender | null;
  siteUrl?: string;
  limit?: number;
  /** Token Checks to re-run per pass. */
  rechecks?: number;
  onAlert?: (token: string, alerts: TokenAlert[]) => Promise<void>;
}

/** One pass over watched tokens: events since the last pass, plus a fresh Token Check for the stalest few. */
export async function runTokenWatch(store: CounterStore, d: TokenWatchDeps) {
  const all = (await store.members("twatch:tokens")).sort();
  const head = await d.logs.getBlockNumber();
  const limit = d.limit ?? 100;
  const cursor = Number((await store.fetch("twatch:cursor")) ?? 0) % Math.max(1, all.length);
  const batch = [...all.slice(cursor), ...all.slice(0, cursor)].slice(0, limit);
  await store.put("twatch:cursor", String((cursor + batch.length) % Math.max(1, all.length)));
  let rechecks = d.rechecks ?? 4, scanned = 0, notified = 0, removed = 0, failed = 0, alerts = 0;
  for (const t of batch) {
    const token = getAddress(t);
    let meta = JSON.parse((await store.fetch(`twatch:meta:${t}`)) ?? "null") as TokenMeta | null;
    if (!meta) continue;
    const found: TokenAlert[] = [];
    const lastRaw = await store.fetch(`twatch:last:${t}`);
    // a pass more than a day behind restarts from now instead of replaying (and alerting on) old history
    const from = lastRaw && head - BigInt(lastRaw) < 800_000n ? BigInt(lastRaw) + 1n : head;
    try {
      if (from < head) found.push(...await tokenEvents(d.logs, d.client, token, meta, from, head));
      await store.put(`twatch:last:${t}`, head.toString(), FOREVER);
      scanned++;
    } catch { failed++; continue; }
    const prev = JSON.parse((await store.fetch(`twatch:verdict:${t}`)) ?? "null") as Verdict | null;
    if (rechecks > 0 && (!prev || Date.now() - prev.at > RECHECK_MS)) {
      rechecks--;
      const r = await d.check(token).catch(() => null);
      // a check that could not reach the chain says nothing about the token: keep the last verdict
      if (r && !r.findings.some((f) => f.code === "SIM_UNAVAILABLE")) {
        const ch = verdictChange(prev, r, meta);
        found.push(...ch.alerts);
        meta = ch.meta;
        await store.put(`twatch:meta:${t}`, JSON.stringify(meta), FOREVER);
        await store.put(`twatch:verdict:${t}`, JSON.stringify(verdictOf(r)), FOREVER);
      }
    }
    if (!found.length) continue;
    alerts += found.length;
    if (d.onAlert) await d.onAlert(t, found).catch(() => {});
    if (!d.send) continue;
    // the most serious first; several at once go in one notification
    const order = ["liquidity_removed", "verdict_worse", "dev_sold", "whale_sold", "dev_moved", "graduated"];
    found.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    const payload = JSON.stringify({
      title: found[0]!.title,
      body: found.length > 1 ? `${found[0]!.body} Also: ${found.slice(1).map((a) => a.title.split(": ").slice(1).join(": ") || a.title).join("; ")}.` : found[0]!.body,
      url: `${d.siteUrl ?? "https://heimdall.fund"}/token-check/${token}`,
      tag: `twatch-${t}-${found[0]!.kind}`,
    });
    for (const id of await store.members(`twatch:tok:${t}`)) {
      const sub = JSON.parse((await store.fetch(`twatch:sub:${id}`)) ?? "null") as StoredSub | null;
      if (!sub) { await store.removeMember(`twatch:tok:${t}`, id); continue; }
      const r = await d.send(sub, payload).catch(() => ({ gone: false }));
      if (r.gone) { await unsubscribeToken(store, sub.endpoint); removed++; } else notified++;
    }
  }
  return { watched: all.length, scanned, alerts, notified, removed, failed };
}
