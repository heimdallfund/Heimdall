import { badgeSvg, svgResponse } from "@/lib/badge";
import { SHIELD_API_URL } from "@/lib/config";

/** Live badge for an agent wallet: how many of its transactions Shield checked, and the share allowed. */
export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return svgResponse(badgeSvg("Heimdall", "invalid address", "muted"), 3600);
  const s = await fetch(`${SHIELD_API_URL}/v1/agents/${address}`, { signal: AbortSignal.timeout(3000), next: { revalidate: 600 } })
    .then((r) => (r.ok ? (r.json() as Promise<{ checks: number; allowed: number }>) : null)).catch(() => null);
  if (!s || s.checks < 10) return svgResponse(badgeSvg("Heimdall", "Shield-protected", "brand"));
  const pct = Math.round((s.allowed / s.checks) * 100);
  return svgResponse(badgeSvg("Heimdall", `${s.checks.toLocaleString("en-US")} checks · ${pct}% clean`, pct >= 90 ? "allow" : "brand"));
}
