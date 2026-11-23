import { badgeSvg, svgResponse } from "@/lib/badge";
import { readVault } from "@/lib/reads";

/** Live badge for a vault: its onchain loss limits. */
export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return svgResponse(badgeSvg("Heimdall vault", "invalid address", "muted"), 3600);
  const v = await readVault(address as `0x${string}`).catch(() => null);
  if (!v) return svgResponse(badgeSvg("Heimdall vault", "not found", "muted"), 300);
  return svgResponse(badgeSvg("Heimdall vault", `max loss ${v.maxLossPct}%/trade · ${v.maxDailyLossPct}%/day`, "allow"));
}
