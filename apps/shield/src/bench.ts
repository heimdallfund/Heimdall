import type { CounterStore } from "./store.js";
import type { TokenCheck } from "./tokencheck.js";

/**
 * Measured accuracy, forward in time. Each token the Radar checks gets its first verdict recorded. A day later it is
 * checked again and what actually happened is read from the chain: liquidity pulled, selling stopped working, or the
 * dev sold out. The scorecard compares the two: how many tokens that went bad had been flagged beforehand, and how
 * many tokens Heimdall passed went bad anyway. Nothing is back-filled or tuned after the fact.
 */
export interface Prediction { verdict: TokenCheck["verdict"]; flags: string[]; at: number; symbol: string | null }
export type Outcome = "rugged" | "honeypot" | "dumped" | "fine";
export interface Evaluated extends Prediction { outcome: Outcome; evaluatedAt: number; evidence: string | null }

const TTL = 30 * 86_400;
const AFTER = 24 * 3_600_000;

export async function recordPrediction(store: CounterStore, token: string, r: TokenCheck, now = Date.now()) {
  const k = `bench:pred:${token.toLowerCase()}`;
  if (await store.fetch(k)) return; // only the first verdict counts
  const p: Prediction = { verdict: r.verdict, flags: r.findings.filter((f) => f.severity !== "info").map((f) => f.code).slice(0, 6), at: now, symbol: r.symbol };
  await store.put(k, JSON.stringify(p), TTL);
  await store.addMember("bench:pending", token.toLowerCase());
}

/** What happened, from a fresh check: these findings describe events that already took place, not risks. */
export function outcomeOf(r: TokenCheck): { outcome: Outcome; evidence: string | null } {
  const f = (code: string) => r.findings.find((x) => x.code === code);
  const rug = f("LIQUIDITY_REMOVED");
  if (rug) return { outcome: "rugged", evidence: rug.message };
  const hp = f("HONEYPOT") ?? f("TRANSFER_BLOCKED") ?? f("ALLOWANCE_BYPASS");
  if (hp) return { outcome: "honeypot", evidence: hp.message };
  const sold = r.holders?.devSoldPct;
  if (sold != null && sold >= 90 && f("DEV_SOLD")) return { outcome: "dumped", evidence: f("DEV_SOLD")!.message };
  return { outcome: "fine", evidence: null };
}

/** Re-checks predictions older than a day (a few per call) and files the outcome. */
export async function evaluateDue(store: CounterStore, check: (token: string) => Promise<TokenCheck>, max = 3, now = Date.now()) {
  let done = 0;
  for (const t of await store.members("bench:pending")) {
    if (done >= max) break;
    const p = JSON.parse((await store.fetch(`bench:pred:${t}`)) ?? "null") as Prediction | null;
    if (!p) { await store.removeMember("bench:pending", t); continue; }
    if (now - p.at < AFTER) continue;
    const r = await check(t).catch(() => null);
    if (!r || r.findings.some((x) => x.code === "SIM_UNAVAILABLE")) continue; // try again next time
    const o = outcomeOf(r);
    const e: Evaluated = { ...p, ...o, evaluatedAt: now };
    await store.put(`bench:eval:${t}`, JSON.stringify(e), TTL);
    await store.addMember("bench:evaluated", t);
    await store.removeMember("bench:pending", t);
    done++;
  }
  return done;
}

export interface Scorecard {
  since: number | null;
  pending: number;
  evaluated: number;
  bad: number;
  /** Of the tokens that went bad, how many were WARN or DENY beforehand. */
  caught: number;
  /** Of the tokens Heimdall passed (ALLOW), how many went bad anyway. */
  passed: number;
  passedBad: number;
  /** Of the tokens Heimdall denied, how many went bad. */
  denied: number;
  deniedBad: number;
  byOutcome: Record<Outcome, number>;
  recent: { token: string; symbol: string | null; verdict: Prediction["verdict"]; outcome: Outcome; at: number }[];
}

export async function scorecard(store: CounterStore): Promise<Scorecard> {
  const evaluated = await store.members("bench:evaluated");
  const rows = (await Promise.all(evaluated.map(async (t) => ({ t, e: JSON.parse((await store.fetch(`bench:eval:${t}`)) ?? "null") as Evaluated | null }))))
    .filter((x): x is { t: string; e: Evaluated } => !!x.e);
  const bad = rows.filter((x) => x.e.outcome !== "fine");
  const byOutcome: Record<Outcome, number> = { rugged: 0, honeypot: 0, dumped: 0, fine: 0 };
  for (const x of rows) byOutcome[x.e.outcome]++;
  return {
    since: rows.length ? Math.min(...rows.map((x) => x.e.at)) : null,
    pending: (await store.members("bench:pending")).length,
    evaluated: rows.length,
    bad: bad.length,
    caught: bad.filter((x) => x.e.verdict !== "ALLOW").length,
    passed: rows.filter((x) => x.e.verdict === "ALLOW").length,
    passedBad: bad.filter((x) => x.e.verdict === "ALLOW").length,
    denied: rows.filter((x) => x.e.verdict === "DENY").length,
    deniedBad: bad.filter((x) => x.e.verdict === "DENY").length,
    byOutcome,
    recent: bad.sort((a, b) => b.e.evaluatedAt - a.e.evaluatedAt).slice(0, 12).map((x) => ({ token: x.t, symbol: x.e.symbol, verdict: x.e.verdict, outcome: x.e.outcome, at: x.e.at })),
  };
}
