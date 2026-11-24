import { SHIELD_API_URL } from "./config";

export type Leg = { ok: boolean; taxPct: number | null; reason?: string } | null;
export type TokenReport = {
  token: string; symbol: string | null; name: string | null; decimals: number | null; owner: string | null;
  verdict: "ALLOW" | "WARN" | "DENY"; riskScore: number; findings: { code: string; severity: "info" | "warn" | "deny"; message: string }[];
  pool: { version?: 3 | 4; address: string; fee: number; pair: string; liquidity: string; hooks?: string } | null; buy: Leg; sell: Leg; transfer: Leg; pullableBy: string[]; checkedAt: number;
};

export const VERDICT_HEAD = { ALLOW: "Looks tradable", WARN: "Be careful", DENY: "Do not buy" } as const;

/** One Token Check from Shield (which caches it for a minute). `status` explains a failure. */
export async function fetchTokenCheck(address: string, timeout = 25_000): Promise<{ report: TokenReport | null; status: number | null }> {
  const res = await fetch(`${SHIELD_API_URL}/v1/token/${address}`, { signal: AbortSignal.timeout(timeout), cache: "no-store" }).catch(() => null);
  if (!res) return { report: null, status: null };
  return { report: res.ok ? ((await res.json().catch(() => null)) as TokenReport | null) : null, status: res.status };
}

/** Plain text for one simulated leg, shared by the report and its preview image. */
export function legText(leg: Leg, good = "Works, no tax") {
  return leg === null ? "Not simulated" : !leg.ok ? "Fails" : leg.taxPct ? `${leg.taxPct.toFixed(1)}% tax` : good;
}
export function legState(leg: Leg): "ok" | "warn" | "bad" | "skip" {
  return leg === null ? "skip" : !leg.ok ? "bad" : (leg.taxPct ?? 0) >= 50 ? "bad" : (leg.taxPct ?? 0) >= 10 ? "warn" : "ok";
}
