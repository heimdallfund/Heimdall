/** Pure alert rules: snapshot in, alerts out. No I/O, so they are easy to test. */

export interface Exec { tx: string; navBefore: bigint; navAfter: bigint }
export interface VaultSnapshot {
  address: string;
  name: string;
  paused: boolean;
  nav: bigint | null; // null when a price feed is stale or broken
  staleAssets: string[];
  depositCap: bigint;
  maxDailyLossBps: number;
  lossWindowStart: number; // unix seconds
  lossWindowNav: bigint;
  lossWindowLoss: bigint;
  execs: Exec[]; // trades since the previous run
}
export interface Snapshot { now: number; shieldOk: boolean | null; vaults: VaultSnapshot[] }
export interface Thresholds { tradeLossBps: number; dailyBudgetUsedPct: number; capUsedPct: number }
export type Severity = "critical" | "warning" | "info";
export interface Alert { key: string; severity: Severity; title: string; detail: string }

export const DEFAULTS: Thresholds = { tradeLossBps: 100, dailyBudgetUsedPct: 70, capUsedPct: 95 };
const usd = (v: bigint) => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function evaluate(s: Snapshot, t: Thresholds = DEFAULTS): Alert[] {
  const out: Alert[] = [];
  if (s.shieldOk === false) out.push({ key: "shield:down", severity: "critical", title: "Shield API is down", detail: "Health check failed. Agents cannot get receipts, so vault trading is effectively halted." });
  for (const v of s.vaults) {
    const id = `${v.name} (${short(v.address)})`;
    if (v.paused) out.push({ key: `${v.address}:paused`, severity: "warning", title: `Vault paused: ${id}`, detail: "Deposits and trading are stopped; withdrawals and in-kind exits still work." });
    if (v.nav === null || v.staleAssets.length) out.push({ key: `${v.address}:stale`, severity: "critical", title: `Stale price feed: ${id}`, detail: `Feeds not updating for ${v.staleAssets.join(", ") || "a tracked asset"}. Valuation-dependent actions are blocked until the feed recovers or is replaced (OP=set-feed).` });
    for (const e of v.execs) {
      if (e.navAfter >= e.navBefore || e.navBefore === 0n) continue;
      const bps = Number(((e.navBefore - e.navAfter) * 10_000n) / e.navBefore);
      if (bps >= t.tradeLossBps) out.push({ key: `${v.address}:trade:${e.tx}`, severity: bps >= 250 ? "critical" : "warning", title: `Losing trade: ${id}`, detail: `NAV ${usd(e.navBefore)} → ${usd(e.navAfter)} USDG (−${(bps / 100).toFixed(2)}%) in ${short(e.tx)}.` });
    }
    const windowOpen = s.now < v.lossWindowStart + 86_400;
    if (windowOpen && v.lossWindowNav > 0n && v.maxDailyLossBps > 0) {
      const budget = (v.lossWindowNav * BigInt(v.maxDailyLossBps)) / 10_000n;
      const usedPct = budget === 0n ? 0 : Number((v.lossWindowLoss * 100n) / budget);
      if (usedPct >= t.dailyBudgetUsedPct) out.push({ key: `${v.address}:budget`, severity: usedPct >= 95 ? "critical" : "warning", title: `Daily loss budget ${usedPct}% used: ${id}`, detail: `Lost ${usd(v.lossWindowLoss)} of a ${usd(budget)} USDG 24h budget. Further losing trades will revert.` });
    }
    if (v.nav !== null && v.depositCap > 0n && v.depositCap < 2n ** 255n) {
      const usedPct = Number((v.nav * 100n) / v.depositCap);
      if (usedPct >= t.capUsedPct) out.push({ key: `${v.address}:cap`, severity: "info", title: `Deposit cap ${usedPct}% full: ${id}`, detail: `NAV ${usd(v.nav)} of ${usd(v.depositCap)} USDG. Consider raising it (OP=deposit-cap) if the record supports it.` });
    }
  }
  return out;
}

/** Alert once when a condition starts, once when it clears; trade alerts are one-shot. */
export function diff(prevActive: Set<string>, alerts: Alert[]): { fire: Alert[]; resolved: string[]; active: Set<string> } {
  const active = new Set(alerts.filter((a) => !a.key.includes(":trade:")).map((a) => a.key));
  const fire = alerts.filter((a) => a.key.includes(":trade:") || !prevActive.has(a.key));
  const resolved = [...prevActive].filter((k) => !active.has(k));
  return { fire, resolved, active };
}

export function format(a: Alert): string {
  const icon = { critical: "🔴", warning: "🟠", info: "🔵" }[a.severity];
  return `${icon} ${a.title}\n${a.detail}`;
}
