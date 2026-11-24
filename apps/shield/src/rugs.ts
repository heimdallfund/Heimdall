import type { CounterStore } from "./store.js";
import type { TokenCheck } from "./tokencheck.js";
import { outcomeOf } from "./bench.js";

/**
 * Rug log: tokens Heimdall checked while they were still alive and that later rugged (liquidity pulled) or turned into
 * a honeypot (selling stopped working). The verdict shown for each is the one from the first check, stored at the time
 * of that check, before anything happened. Tokens that were already dead when first checked are never listed, and
 * tokens Heimdall passed that rugged anyway are listed too: this is a record, not a highlight reel.
 */
export interface FirstSeen { verdict: TokenCheck["verdict"]; riskScore: number; flags: string[]; at: number; symbol: string | null; alive: boolean }
export interface RugEvent {
  token: string;
  symbol: string | null;
  name: string | null;
  venue: string | null;
  kind: "rugged" | "honeypot";
  detectedAt: number;
  /** The finding that shows it, from the check that caught it. */
  evidence: string;
  /** Heimdall's first verdict on the token, recorded before the rug. */
  before: { verdict: TokenCheck["verdict"]; riskScore: number; flags: string[]; at: number };
}

const TTL = 90 * 86_400;
const WATCH_FOR = 72 * 3_600_000;
const RANK = { deny: 0, warn: 1, info: 2 } as const;
/** Flags that make a rug more likely: these tokens are re-checked more often. */
const RISKY = new Set(["LP_REMOVABLE", "LOW_LIQUIDITY", "SERIAL_DUMPER", "OWNER_CAN_MINT", "OWNER_CAN_BLACKLIST", "OWNER_CAN_PAUSE", "OWNER_CAN_RAISE_TAX", "UPGRADEABLE", "SELL_BLOCKED_LATER", "TAX_RISES_LATER"]);

export const flagsOf = (r: TokenCheck) => [...r.findings].filter((f) => f.severity !== "info").sort((a, b) => RANK[a.severity] - RANK[b.severity]).map((f) => f.code).slice(0, 8);
const unusable = (r: TokenCheck) => r.findings.some((f) => f.code === "SIM_UNAVAILABLE");
/** A check with no market to trade on (no pool yet) cannot judge a rug risk, so it is not a "before" to compare with. */
const NO_MARKET = "NO_POOL";
const judged = (flags: string[]) => !flags.includes(NO_MARKET);

/** Keeps the first usable check of a token, and puts tokens that were alive then on the rug watch. */
export async function recordSeen(store: CounterStore, token: string, r: TokenCheck, now = Date.now()) {
  if (unusable(r)) return null;
  const t = token.toLowerCase();
  const k = `seen:${t}`;
  const had = JSON.parse((await store.fetch(k)) ?? "null") as FirstSeen | null;
  const flags = flagsOf(r);
  const alive = outcomeOf(r).outcome === "fine";
  // the first check stays the "before", unless it saw no market yet: then the first check with a pool replaces it
  if (had && (judged(had.flags) || !alive || !judged(flags))) return had;
  const s: FirstSeen = { verdict: r.verdict, riskScore: r.riskScore, flags, at: now, symbol: r.symbol, alive };
  await store.put(k, JSON.stringify(s), TTL);
  if (had) return s; // already on the watch
  // the member carries what the sweep needs, so picking tokens to re-check costs one read
  if (s.alive) await store.addMember("rugwatch", `${t}|${now}|${flags.some((f) => RISKY.has(f)) ? 1 : 0}`);
  return s;
}

/** Files a rug when a fresh check shows one for a token that was alive at its first check. Returns the new event. */
export async function noteOutcome(store: CounterStore, token: string, r: TokenCheck, now = Date.now()): Promise<RugEvent | null> {
  if (unusable(r)) return null;
  const o = outcomeOf(r);
  if (o.outcome !== "rugged" && o.outcome !== "honeypot") return null;
  const t = token.toLowerCase();
  if (await store.fetch(`rug:${t}`)) return null;
  const s = JSON.parse((await store.fetch(`seen:${t}`)) ?? "null") as FirstSeen | null;
  // only tokens Heimdall saw alive, at least a couple of minutes before
  if (!s || !s.alive || !judged(s.flags) || now - s.at < 120_000) return null;
  const e: RugEvent = {
    token: t, symbol: r.symbol ?? s.symbol, name: r.name, venue: r.launch?.launchpad ?? null,
    kind: o.outcome, detectedAt: now, evidence: o.evidence ?? "",
    before: { verdict: s.verdict, riskScore: s.riskScore, flags: s.flags, at: s.at },
  };
  await store.put(`rug:${t}`, JSON.stringify(e), TTL);
  await store.addMember("rugs:all", t);
  return e;
}

/**
 * Re-checks tokens on the rug watch, oldest-checked first: risky ones every 10 minutes, the rest every 45, for three
 * days after they were first seen. `budgetMs` keeps it inside the caller's run.
 */
export async function sweepRugs(store: CounterStore, check: (token: string) => Promise<TokenCheck>, opts: { max?: number; budgetMs?: number; now?: number } = {}) {
  const now = opts.now ?? Date.now(), started = Date.now();
  const swept = JSON.parse((await store.fetch("rugwatch:swept")) ?? "{}") as Record<string, number>;
  const due: { member: string; t: string; stale: number }[] = [];
  for (const member of await store.members("rugwatch")) {
    const [t, at, risky] = member.split("|");
    const seenAt = Number(at);
    if (!t || !Number.isFinite(seenAt) || now - seenAt > WATCH_FOR) { await store.removeMember("rugwatch", member); delete swept[t ?? ""]; continue; }
    const last = Math.max(seenAt, swept[t] ?? 0);
    const every = risky === "1" ? 10 * 60_000 : 45 * 60_000;
    if (now - last >= every) due.push({ member, t, stale: (now - last) / every });
  }
  due.sort((a, b) => b.stale - a.stale);
  const todo = due.slice(0, opts.max ?? 6);
  const found: RugEvent[] = [];
  let next = 0, checked = 0;
  const worker = async () => {
    while (next < todo.length && Date.now() - started < (opts.budgetMs ?? 40_000)) {
      const d = todo[next++]!;
      const r = await check(d.t).catch(() => null);
      if (!r || unusable(r)) continue;
      checked++;
      swept[d.t] = now;
      const e = await noteOutcome(store, d.t, r, now).catch(() => null);
      if (e) found.push(e);
      if (outcomeOf(r).outcome !== "fine") { await store.removeMember("rugwatch", d.member); delete swept[d.t]; }
    }
  };
  await Promise.all([worker(), worker()]);
  await store.put("rugwatch:swept", JSON.stringify(swept), 4 * 86_400);
  return { watching: (await store.members("rugwatch")).length, due: due.length, checked, found };
}

export interface RugLog {
  events: RugEvent[];
  total: number;
  /** Rugs whose first verdict was WARN or DENY. */
  flagged: number;
  denied: number;
  /** Rugs Heimdall had passed (ALLOW). */
  passed: number;
  /** Rugs whose first check had already said the liquidity could be pulled. */
  lpWarned: number;
  watching: number;
}

export async function rugLog(store: CounterStore, limit = 100): Promise<RugLog> {
  const all = await store.members("rugs:all");
  const events = (await Promise.all(all.map(async (t) => JSON.parse((await store.fetch(`rug:${t}`)) ?? "null") as RugEvent | null)))
    // early records whose "before" had no pool yet: Heimdall had nothing to judge then, so they are not counted
    .filter((e): e is RugEvent => !!e && judged(e.before.flags)).sort((a, b) => b.detectedAt - a.detectedAt);
  return {
    events: events.slice(0, limit),
    total: events.length,
    flagged: events.filter((e) => e.before.verdict !== "ALLOW").length,
    denied: events.filter((e) => e.before.verdict === "DENY").length,
    passed: events.filter((e) => e.before.verdict === "ALLOW").length,
    lpWarned: events.filter((e) => e.before.flags.includes("LP_REMOVABLE")).length,
    watching: (await store.members("rugwatch")).length,
  };
}
