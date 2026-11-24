export interface RadarCheck { verdict: "ALLOW" | "WARN" | "DENY"; riskScore: number; flags: string[]; holders: number | null; top10Pct: number | null; devSoldPct: number | null; progressPct: number | null; checkedAt: number }
export interface RadarToken { token: string; symbol: string | null; name: string | null; venue: string; launchedAt: number; buyers1h: number; buys1h: number; sells1h: number; check: RadarCheck | null }
export interface RadarSnapshot { generatedAt: number; block: string; launched24h: number; tokens: RadarToken[] }
