export type Verdict = "ALLOW" | "WARN" | "DENY";
export interface RugEvent {
  token: string; symbol: string | null; name: string | null; venue: string | null;
  kind: "rugged" | "honeypot"; detectedAt: number; evidence: string;
  before: { verdict: Verdict; riskScore: number; flags: string[]; at: number };
}
export interface RugLog { events: RugEvent[]; total: number; flagged: number; denied: number; passed: number; lpWarned: number; watching: number }

export const RUG_WORD = { rugged: "Liquidity pulled", honeypot: "Selling stopped" } as const;
export const utc = (t: number) => `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
export const span = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
