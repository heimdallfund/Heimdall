import type { CounterStore } from "./store.js";
import type { Season } from "./arena.js";
import { seasonsFromEnv } from "./arena.js";

/**
 * Operations helpers behind the admin panel: Arena seasons editable at runtime, a short history of report decisions,
 * and privacy-friendly product analytics (daily counters only: no cookies, no IPs, no wallet addresses).
 */

// ── Arena seasons ──────────────────────────────────────────────────────────────
const SEASONS_KEY = "arena:seasons";

/** Seasons saved from the admin panel win over ARENA_SEASONS in the environment. */
export async function loadSeasons(store: CounterStore, env: NodeJS.ProcessEnv = process.env): Promise<Season[]> {
  const saved = await store.fetch(SEASONS_KEY).catch(() => null);
  if (saved) { try { return JSON.parse(saved) as Season[]; } catch { /* fall through */ } }
  return seasonsFromEnv(env);
}

export function validateSeasons(input: unknown): { ok: true; seasons: Season[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length > 50) return { ok: false, error: "seasons must be an array of at most 50" };
  const out: Season[] = [];
  const ids = new Set<number>();
  for (const [i, s] of input.entries()) {
    const r = s as Partial<Season>;
    const at = `season ${i + 1}`;
    if (!Number.isInteger(r.id) || r.id! < 1) return { ok: false, error: `${at}: id must be a positive integer` };
    if (ids.has(r.id!)) return { ok: false, error: `${at}: id ${r.id} is used twice` };
    if (typeof r.name !== "string" || !r.name.trim() || r.name.length > 60) return { ok: false, error: `${at}: name is required (60 characters max)` };
    if (!Number.isFinite(r.start) || !Number.isFinite(r.end) || r.end! <= r.start!) return { ok: false, error: `${at}: end must be after start` };
    if (!Number.isFinite(r.minTvl) || r.minTvl! < 0 || !Number.isInteger(r.minDepositors) || r.minDepositors! < 0) return { ok: false, error: `${at}: minimum TVL and depositors must be zero or more` };
    if (r.prize !== undefined && (typeof r.prize !== "string" || r.prize.length > 120)) return { ok: false, error: `${at}: prize is text, 120 characters max` };
    ids.add(r.id!);
    out.push({ id: r.id!, name: r.name.trim(), start: r.start!, end: r.end!, minTvl: r.minTvl!, minDepositors: r.minDepositors!, ...(r.prize ? { prize: r.prize } : {}) });
  }
  return { ok: true, seasons: out.sort((a, b) => a.start - b.start) };
}

export async function saveSeasons(store: CounterStore, seasons: Season[], previous: Season[]) {
  await store.put(SEASONS_KEY, JSON.stringify(seasons));
  for (const s of [...seasons, ...previous]) await store.remove(`arena:cache:${s.id}`).catch(() => {});
}

// ── Report decisions ───────────────────────────────────────────────────────────
export interface Decision { id: string; address: string; reporter: string; status: string; at: number; by: "admin" | "unblock" }
const DECISIONS_KEY = "reports:decided:recent";

export async function logDecision(store: CounterStore, d: Decision) {
  const list = JSON.parse((await store.fetch(DECISIONS_KEY)) ?? "[]") as Decision[];
  list.unshift(d);
  await store.put(DECISIONS_KEY, JSON.stringify(list.slice(0, 100)));
}
export async function recentDecisions(store: CounterStore): Promise<Decision[]> {
  return JSON.parse((await store.fetch(DECISIONS_KEY)) ?? "[]") as Decision[];
}

// ── Analytics ──────────────────────────────────────────────────────────────────
/** The only events the web app may record. Anything else is ignored. */
export const EVENTS = [
  "pageview", "wallet_check", "revoke", "report_submitted", "stake", "unstake", "claim",
  "pay_job_created", "pay_released", "plan_created", "vault_deposit", "shield_console_check", "docs_copy", "early_access", "watch_on", "token_watch_on", "token_check",
] as const;
export type EventName = (typeof EVENTS)[number];

const DAY_TTL = 120 * 86_400;
const DAILY_CAP = 500_000;
const MAX_PATHS = 300;

/** Collapses addresses and ids so a path never identifies a wallet: /check/0xabc… → /check/:address. */
export function normalizePath(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 200) return null;
  const p = path.split(/[?#]/)[0]!
    .replace(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g, ":hash")
    .replace(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g, ":address")
    .replace(/0x[0-9a-fA-F]{8,}/g, ":hex")
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\/+$/, "") || "/";
  return /^[a-zA-Z0-9/:_\-.]{1,80}$/.test(p) ? p : null;
}

export async function trackEvent(store: CounterStore, name: unknown, path: unknown, now = Date.now()): Promise<boolean> {
  if (typeof name !== "string" || !(EVENTS as readonly string[]).includes(name)) return false;
  const day = new Date(now).toISOString().slice(0, 10);
  if ((await store.incr(`ev:cap:${day}`, DAY_TTL)) > DAILY_CAP) return false;
  await store.incr(`ev:${day}:${name}`, DAY_TTL);
  if (name === "pageview") {
    const p = normalizePath(path);
    if (!p) return true;
    const known = await store.members(`pv:paths:${day}`);
    if (!known.includes(p)) {
      if (known.length >= MAX_PATHS) return true;
      await store.addMember(`pv:paths:${day}`, p);
    }
    await store.incr(`pv:${day}:${p}`, DAY_TTL);
  }
  return true;
}

export async function analytics(store: CounterStore, days = 14, now = Date.now()) {
  const list = Array.from({ length: Math.min(90, Math.max(1, days)) }, (_, i) => new Date(now - i * 86_400_000).toISOString().slice(0, 10)).reverse();
  const daily = await Promise.all(list.map(async (day) => {
    const counts = Object.fromEntries(await Promise.all(EVENTS.map(async (e) => [e, await store.get(`ev:${day}:${e}`)] as const)));
    return { day, ...counts } as { day: string } & Record<EventName, number>;
  }));
  const pages = new Map<string, number>();
  for (const day of list) {
    for (const p of await store.members(`pv:paths:${day}`)) pages.set(p, (pages.get(p) ?? 0) + (await store.get(`pv:${day}:${p}`)));
  }
  const totals = Object.fromEntries(EVENTS.map((e) => [e, daily.reduce((s, d) => s + (d[e] ?? 0), 0)])) as Record<EventName, number>;
  return { days: list, daily, totals, topPages: [...pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([path, views]) => ({ path, views })) };
}
