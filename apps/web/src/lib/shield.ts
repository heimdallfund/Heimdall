import { cacheLife } from "next/cache";
import { SHIELD_API_URL } from "./config";

export interface SharedVerdict {
  kind: "tx" | "sig";
  at: number;
  chainId: number;
  tx?: { from: string; to: string | null; data: string; value: string };
  signer?: string;
  primaryType?: string;
  result: { verdict: "ALLOW" | "WARN" | "DENY"; riskScore: number; summary: string[]; findings: { code: string; severity: string; message: string }[]; checkId?: string };
}
export interface Threats {
  window: string;
  codes: { code: string; count: number }[];
  targets: { address: string; denies: number; blocklisted: boolean }[];
  recent: { at: number; kind: string; target: string | null; codes: string[]; summary: string }[];
  blocklist: { address: string; label?: string; source?: string; addedAt?: string }[];
}
export interface AgentStats { address: string; checks: number; allowed: number; warned: number; denied: number; firstSeen: number | null; lastSeen: number | null }

async function get<T>(path: string, timeout = 3000): Promise<T | null> {
  try {
    const res = await fetch(`${SHIELD_API_URL}${path}`, { signal: AbortSignal.timeout(timeout) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function fetchVerdict(id: string) { "use cache"; cacheLife("hours"); return get<SharedVerdict>(`/v1/verdicts/${id}`); }
export async function fetchThreats() { "use cache"; cacheLife("minutes"); return get<Threats>("/v1/threats"); }
export async function fetchAgentStats(address: string) { "use cache"; cacheLife("minutes"); return get<AgentStats>(`/v1/agents/${address}`); }
export async function fetchSigner() {
  "use cache";
  cacheLife("minutes");
  const r = await get<{ signer: string }>("/v1/signer");
  return r?.signer ? { address: r.signer } : null;
}

/** Plain-language names for finding codes (Threat Board, verdict pages). */
export { CODE_LABEL } from "./codes";
import { CODE_LABEL } from "./codes";
export const label = (code: string) => CODE_LABEL[code] ?? code.replace(/_/g, " ").toLowerCase();

/** Short title for a verdict: the name of its most severe finding, never an address. */
export function verdictTitle(r: { verdict: string; findings: { code: string; severity: string }[] }): string {
  const top = r.findings.find((f) => f.severity === "deny") ?? r.findings.find((f) => f.severity === "warn");
  if (!top) return r.verdict === "ALLOW" ? "Nothing risky found" : "Checked by Heimdall Shield";
  const t = label(top.code);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Best one-line headline for a verdict: the most severe finding, else the first summary line. */
export function headline(r: { summary: string[]; findings: { severity: string; message: string }[] }): string {
  return r.findings.find((f) => f.severity === "deny")?.message ?? r.findings.find((f) => f.severity === "warn")?.message ?? r.summary[0] ?? "Checked by Heimdall Shield";
}

export interface PointsRow { address: string; total: number }
export async function fetchLeaderboard() { "use cache"; cacheLife("minutes"); return get<PointsRow[]>("/v1/points/leaderboard?limit=50"); }

export interface ArenaSeason { id: number; name: string; start: number; end: number; minTvl: number; minDepositors: number; prize?: string }
export interface ArenaStanding { vault: string; name: string; manager: string; returnPct: number; maxDrawdownPct: number; tvl: number; depositors: number; eligible: boolean; reason?: string; spark: number[]; rank?: number }
export async function fetchArena() { "use cache"; cacheLife("minutes"); return get<{ season: ArenaSeason | null; standings: ArenaStanding[] }>("/v1/arena"); }

export interface PassportComponent { name: "shield" | "pay" | "history"; score: number; weight: number; detail: string }
export interface Passport {
  address: string;
  agentId: string | null;
  linked: boolean;
  score: number | null;
  tier: "A" | "B" | "C" | "D" | "new" | "blocked";
  capped?: string;
  components: PassportComponent[];
  identity: { agentId: string; owner: string; wallet: string | null; uri: string | null; registry: string; registration: { name?: string; description?: string; image?: string; services?: { name: string; endpoint: string }[]; x402Support?: boolean; active?: boolean } | null } | null;
  shield: AgentStats;
  pay: { completed: number; disputed: number; earnedUsdg: number } | null;
  risk: { level: number; levelName: string; flagNames: string[]; label: string | null; blocked: boolean };
  reputation: { count: number; average: number | null; publisher: string } | null;
  publisher: string | null;
  updatedAt: string;
}
export interface PassportRow { address: string; agentId: string | null; name: string | null; score: number | null; tier: string }
export interface X402Stats { enabled: boolean; network: string; asset: string; settled: number; volumeUsdg: number; paidShieldCalls: number; prices: { check: string; wallet: string } }
export interface RiskList { chainId: number; oracle: string | null; count: number; entries: { address: string; level: number; levelName: string; flagNames: string[]; label?: string; source: string }[] }

export async function fetchPassport(id: string, agentId?: string) { "use cache"; cacheLife("minutes"); return get<Passport>(`/v1/passport/${id}${agentId && /^\d{1,30}$/.test(agentId) ? `?agentId=${agentId}` : ""}`, 6000); }
export async function fetchPassportDirectory() { "use cache"; cacheLife("minutes"); return get<PassportRow[]>("/v1/passport", 6000); }
export async function fetchX402Stats() { "use cache"; cacheLife("minutes"); return get<X402Stats>("/x402/stats"); }
export async function fetchRiskList() { "use cache"; cacheLife("minutes"); return get<RiskList>("/v1/risk"); }
