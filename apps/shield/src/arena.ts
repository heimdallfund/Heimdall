import type { CounterStore } from "./store.js";

/**
 * Agent Arena: AI-managed Heimdall vaults compete on real performance over a season.
 * The monitor posts hourly snapshots of every vault's share price (USDG per share) and TVL; standings are computed
 * from those points: return over the season, worst drawdown, and eligibility (minimum TVL and depositors).
 */
export interface Season { id: number; name: string; start: number; end: number; minTvl: number; minDepositors: number; prize?: string }
export interface Snapshot { vault: string; name: string; manager: string; pps: number; tvl: number; depositors?: number }
type Point = [t: number, pps: number, tvl: number];

const MAX_POINTS = 2_000;
const KEEP = 400 * 86_400;
const lc = (a: string) => a.toLowerCase();

export function seasonsFromEnv(env: NodeJS.ProcessEnv = process.env): Season[] {
  try { return env.ARENA_SEASONS ? (JSON.parse(env.ARENA_SEASONS) as Season[]) : []; } catch { return []; }
}
export function currentSeason(seasons: Season[], now = Date.now()): Season | null {
  return seasons.find((s) => now >= s.start && now < s.end) ?? [...seasons].filter((s) => s.start > now).sort((a, b) => a.start - b.start)[0] ?? seasons.at(-1) ?? null;
}

export async function recordSnapshots(store: CounterStore, at: number, rows: Snapshot[]) {
  for (const r of rows) {
    const v = lc(r.vault);
    const key = `arena:series:${v}`;
    const series = JSON.parse((await store.fetch(key)) ?? "[]") as Point[];
    if (series.length && at - series.at(-1)![0] < 30 * 60_000) continue; // at most one point per 30 min
    series.push([at, r.pps, r.tvl]);
    await store.put(key, JSON.stringify(series.slice(-MAX_POINTS)), KEEP);
    const meta = JSON.parse((await store.fetch(`arena:meta:${v}`)) ?? "{}") as { depositors?: number };
    await store.put(`arena:meta:${v}`, JSON.stringify({ name: r.name, manager: lc(r.manager), depositors: r.depositors ?? meta.depositors ?? 0 }), KEEP);
    await store.addMember("arena:vaults", v);
  }
}

export interface Standing {
  vault: string; name: string; manager: string; returnPct: number; maxDrawdownPct: number; tvl: number; depositors: number;
  eligible: boolean; reason?: string; spark: number[]; rank?: number;
}

export async function standings(store: CounterStore, season: Season, now = Date.now()): Promise<Standing[]> {
  const end = Math.min(now, season.end);
  const vaults = await store.members("arena:vaults");
  const out: Standing[] = [];
  for (const v of vaults) {
    const series = (JSON.parse((await store.fetch(`arena:series:${v}`)) ?? "[]") as Point[]).filter(([t]) => t >= season.start && t <= end);
    if (series.length < 2) continue;
    const meta = JSON.parse((await store.fetch(`arena:meta:${v}`)) ?? "{}") as { name?: string; manager?: string; depositors?: number };
    const base = series[0]![1], last = series.at(-1)!;
    let peak = base, dd = 0;
    for (const [, p] of series) { peak = Math.max(peak, p); dd = Math.max(dd, (peak - p) / peak); }
    const span = last[0] - series[0]![0];
    const depositors = meta.depositors ?? 0;
    const reason = last[2] < season.minTvl ? `TVL below ${season.minTvl.toLocaleString("en-US")} USDG`
      : depositors < season.minDepositors ? `fewer than ${season.minDepositors} depositors`
      : span < 86_400_000 ? "less than 24 h of history" : undefined;
    const step = Math.max(1, Math.floor(series.length / 24));
    out.push({
      vault: v, name: meta.name ?? "Vault", manager: meta.manager ?? "", depositors,
      returnPct: Math.round((last[1] / base - 1) * 10_000) / 100, maxDrawdownPct: Math.round(dd * 10_000) / 100, tvl: Math.round(last[2] * 100) / 100,
      eligible: !reason, reason, spark: series.filter((_, i) => i % step === 0 || i === series.length - 1).map(([, p]) => p),
    });
  }
  out.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.returnPct - a.returnPct || a.maxDrawdownPct - b.maxDrawdownPct);
  let rank = 0;
  for (const s of out) if (s.eligible) s.rank = ++rank;
  return out;
}
