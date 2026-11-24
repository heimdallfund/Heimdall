import { badgeSvg, svgResponse } from "@/lib/badge";
import { embedCheck, topFlags } from "@/lib/embed";

/** Live Token Check badge: the verdict and its main reason, for a launchpad's or explorer's token page. */
export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return svgResponse(badgeSvg("Heimdall", "invalid address", "muted"), 3600);
  const r = await embedCheck(address, 20_000);
  if (!r) return svgResponse(badgeSvg("Token Check", "not checked yet", "muted"), 60);
  if (r.rug) return svgResponse(badgeSvg("Token Check", `RUGGED · ${r.rug.kind === "rugged" ? "liquidity pulled" : "selling stopped"}`, "deny"), 300);
  const flag = topFlags(r, 1)[0];
  const tax = Math.max(r.buy?.taxPct ?? 0, r.sell?.taxPct ?? 0);
  const msg = r.verdict === "ALLOW" ? (tax >= 0.5 ? `ALLOW · ${tax.toFixed(1)}% tax` : "ALLOW · sells, no tax") : `${r.verdict} · ${flag ?? "see report"}`;
  return svgResponse(badgeSvg("Token Check", msg.length > 42 ? `${msg.slice(0, 40)}…` : msg, r.verdict === "ALLOW" ? "allow" : r.verdict === "WARN" ? "warn" : "deny"), 300);
}
