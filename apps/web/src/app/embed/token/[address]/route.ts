import { embedCheck, topFlags } from "@/lib/embed";
import type { TokenReport } from "@/lib/tokencheck";

/**
 * The Token Check card for other sites (launchpads, explorers, wallets), served as a small self-contained HTML page
 * to put in an iframe, or through /embed.js. It tells the parent page its height so the frame fits without scrolling.
 * ?theme=dark for dark pages.
 */
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://heimdall.fund";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MARK = `<svg width="18" height="18" viewBox="0 0 64 64" aria-hidden="true"><polygon points="32,4 9,12 32,30" fill="#5B78FF"/><polygon points="32,4 55,12 32,30" fill="#3355FF"/><polygon points="9,12 9,30 32,30" fill="#7D93FF"/><polygon points="55,12 55,30 32,30" fill="#2742D6"/><polygon points="9,30 32,60 32,30" fill="#4A68FF"/><polygon points="55,30 32,60 32,30" fill="#1F37B8"/></svg>`;

function chips(r: TokenReport): string[] {
  const out: string[] = [];
  const leg = (n: string, l: TokenReport["buy"]) => (l === null ? null : !l.ok ? `${n} fails` : l.taxPct ? `${n} tax ${l.taxPct.toFixed(1)}%` : `${n} ok`);
  for (const c of [leg("Buy", r.buy), leg("Sell", r.sell)]) if (c) out.push(c);
  if (r.liquidity?.removed) out.push("Liquidity pulled");
  else if (r.liquidity?.lp) out.push(r.liquidity.lp.walletPct >= 50 ? `LP ${r.liquidity.lp.walletPct.toFixed(0)}% in a wallet` : r.liquidity.lp.lockedPct + r.liquidity.lp.burnedPct >= 50 ? "LP locked" : "LP in contracts");
  else if (r.launch?.graduated === false) out.push(`${r.launch.launchpad} curve ${r.launch.progressPct?.toFixed(0) ?? "?"}%`);
  if (r.holders?.devSoldPct != null && r.launch?.dev) out.push(`Dev sold ${r.holders.devSoldPct.toFixed(0)}%`);
  if (r.holders?.devHistory?.dumped) out.push(`Dev dumped ${r.holders.devHistory.dumped} before`);
  if (r.holders) out.push(`${r.holders.count.toLocaleString("en-US")} holders`);
  return out.slice(0, 6);
}

function page(address: string, r: TokenReport | null, dark: boolean) {
  const v = r?.verdict;
  const tone = v === "ALLOW" ? "#0B7A3B" : v === "WARN" ? "#A86A00" : v === "DENY" ? "#C21F32" : "#5A6377";
  const rug = r?.rug ?? null;
  const head = rug ? `Rugged: ${rug.kind === "rugged" ? "liquidity pulled" : "selling stopped"}` : v === "ALLOW" ? "Passed the checks" : v === "WARN" ? "Be careful" : v === "DENY" ? "Do not buy" : "Not checked yet";
  const notable = r?.findings.filter((f) => f.severity !== "info").sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "deny" ? -1 : 1))[0];
  const line = rug ? `${rug.evidence || "A re-check shows it can no longer be traded normally."} Detected ${new Date(rug.detectedAt).toISOString().slice(0, 16).replace("T", " ")} UTC; Heimdall's first check said ${rug.before.verdict}.` : !r ? "Heimdall could not check this token right now. Treat it with care." : notable ? notable.message : "Buying, selling and moving it worked in a simulation on the current chain state.";
  const flags = r ? topFlags(r, 3) : [];
  const c = dark ? { bg: "#111318", panel: "#191C23", ink: "#F4F5F8", muted: "#9AA3B5", line: "#2A2F3A" } : { bg: "#FFFFFF", panel: "#F6F5F1", ink: "#14161B", muted: "#5A6377", line: "#E3E1DA" };
  const report = `${SITE}/token-check/${address}?ref=embed`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Token Check${r?.symbol ? ` · ${esc(r.symbol)}` : ""}</title>
<style>
*{box-sizing:border-box;margin:0}html,body{background:transparent}
body{font:14px/1.45 Inter,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:${c.ink}}
.card{border:2px solid ${c.ink};background:${c.bg};padding:14px 16px 12px;box-shadow:4px 4px 0 ${tone};margin:0 4px 6px 0}
.top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.brand{display:flex;align-items:center;gap:7px;font:600 10.5px/1 "JetBrains Mono",ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:${c.muted}}
.stamp{font:800 15px/1 "JetBrains Mono",ui-monospace,Menlo,monospace;color:${tone};border:2px solid ${tone};padding:4px 8px;letter-spacing:.04em}
.name{margin-top:10px;font-size:17px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.name span{font-weight:400;color:${c.muted}}
.head{margin-top:2px;font-weight:600;color:${tone}}
.line{margin-top:2px;color:${c.muted};font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.flags,.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.flag{font-size:12px;font-weight:600;color:${tone};border:1px solid ${tone};padding:1px 6px}
.chip{font:11px/1.6 "JetBrains Mono",ui-monospace,Menlo,monospace;background:${c.panel};border:1px solid ${c.line};padding:0 6px;color:${c.ink}}
.foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:11px;padding-top:9px;border-top:1px dashed ${c.line};font-size:12px;color:${c.muted}}
a{color:${c.ink};font-weight:600;text-decoration:underline;text-decoration-color:#3355FF;text-decoration-thickness:2px;text-underline-offset:3px}
</style></head><body>
<div class="card">
<div class="top"><span class="brand">${MARK}Heimdall Token Check</span><span class="stamp">${esc(rug ? "RUGGED" : v ?? "—")}</span></div>
<div class="name">${esc(r?.symbol ?? `${address.slice(0, 8)}…${address.slice(-4)}`)}${r?.name && r.name !== r.symbol ? ` <span>${esc(r.name)}</span>` : ""}</div>
<div class="head">${head}${r && !rug ? ` · risk ${r.riskScore}/100` : ""}</div>
<div class="line">${esc(line)}</div>
${flags.length ? `<div class="flags">${flags.map((f) => `<span class="flag">${esc(f)}</span>`).join("")}</div>` : ""}
${r ? `<div class="chips">${chips(r).map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>` : ""}
<div class="foot"><span>Simulated on Robinhood Chain${r ? ` · ${new Date(r.checkedAt).toISOString().slice(11, 16)} UTC` : ""}</span><a href="${report}" target="_blank" rel="noopener">Full report</a></div>
</div>
<script>(function(){function s(){try{parent.postMessage({heimdall:"token-check",token:${JSON.stringify(address.toLowerCase())},height:document.body.scrollHeight},"*")}catch(e){}}s();addEventListener("load",s);addEventListener("resize",s)})();</script>
</body></html>`;
}

export async function GET(req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  const dark = new URL(req.url).searchParams.get("theme") === "dark";
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);
  const r = valid ? await embedCheck(address) : null;
  return new Response(page(valid ? address : "0x0000000000000000000000000000000000000000", r, dark), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // made to be framed by any site
      "content-security-policy": "frame-ancestors *",
      "cache-control": r ? "public, max-age=120, s-maxage=300, stale-while-revalidate=600" : "public, max-age=30",
    },
  });
}
