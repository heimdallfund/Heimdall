import { SHIELD_API_URL } from "./config";
import { CODE_LABEL } from "./codes";
import type { TokenReport } from "./tokencheck";

/** Token Check for embeds and badges: cached by Shield for a minute, by the CDN for five. */
export async function embedCheck(address: string, timeout = 25_000): Promise<TokenReport | null> {
  return fetch(`${SHIELD_API_URL}/v1/token/${address}`, { signal: AbortSignal.timeout(timeout), next: { revalidate: 300 } })
    .then((r) => (r.ok ? (r.json() as Promise<TokenReport>) : null)).catch(() => null);
}

const SEV = { deny: 0, warn: 1, info: 2 } as const;
/** The most serious findings, worst first, as short names. */
export function topFlags(r: TokenReport, n = 3): string[] {
  return r.findings.filter((f) => f.severity !== "info").sort((a, b) => SEV[a.severity] - SEV[b.severity]).slice(0, n)
    .map((f) => { const l = CODE_LABEL[f.code] ?? f.code.replace(/_/g, " ").toLowerCase(); return l.charAt(0).toUpperCase() + l.slice(1); });
}
