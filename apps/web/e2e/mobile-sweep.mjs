import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
// Usage: BASE=http://localhost:3100 WIDTH=360 [LINKS=1] node e2e/mobile-sweep.mjs → /tmp/sweep/result.json
const BASE = process.env.BASE ?? "http://localhost:3100";
const WIDTH = Number(process.env.WIDTH ?? 390);
const A = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";
const W = "0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3";
const routes = `/ /admin /agents /app/keys /app/pay /app/shield /arena /badges /brand /changelog /check /docs /docs/agent /docs/api /docs/arena /docs/auto-invest /docs/contracts /docs/frameworks /docs/guard /docs/limits /docs/mcp /docs/passport /docs/pay /docs/points /docs/risk-oracle /docs/sdk /docs/shield /docs/signals /docs/signatures /docs/staking /docs/vaults /docs/wallet-check /docs/webhooks /docs/x402 /early /guard /guides /integrate /invest /legal/privacy /legal/risk /legal/terms /oracle /passport /pay /points /security /shield /signals /signals/new /stake /status /threats /token /token-check /trust /vaults /vaults/new /x402
/agent/${W} /check/${W} /token-check/${A} /vaults/${W} /pay/job/1 /r/abc /v/0x${"1".repeat(64)}
/guides/revoke-token-approvals-robinhood-chain /guides/stop-ai-agent-signing-drainer /guides/robinhood-chain-stock-token-prices /guides/pay-ai-agent-escrow /guides/address-poisoning-robinhood-chain /guides/fake-tokens-real-ticker-robinhood-chain /guides/vanishing-tokens-honeypots-robinhood-chain`.split(/\s+/).filter(Boolean);
mkdirSync("/tmp/sweep", { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: WIDTH, height: 800 }, deviceScaleFactor: 1 });
const links = new Set(); const out = [];
for (const r of routes) {
  const p = await ctx.newPage(); const errors = [];
  p.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  let status = 0;
  try {
    const res = await p.goto(BASE + r, { waitUntil: "load", timeout: 180000 });
    status = res?.status() ?? 0;
    await p.waitForTimeout(2500);
    const info = await p.evaluate(() => {
      const vw = window.innerWidth;
      const clipped = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const s = getComputedStyle(e); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && e.getBoundingClientRect().right <= vw + 1) return true; } return false; };
      const over = [];
      for (const el of document.querySelectorAll("body *")) {
        const rc = el.getBoundingClientRect();
        if (rc.width === 0 || rc.right <= vw + 1) continue;
        if (getComputedStyle(el).position === "fixed") continue;
        if (clipped(el)) continue;
        over.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} → ${Math.round(rc.right)}px "${(el.textContent || "").trim().slice(0, 40)}"`);
        if (over.length > 4) break;
      }
      // content cut off by an overflow-hidden box (not a scroller, not an intentional ellipsis)
      const cut = [];
      for (const el of document.querySelectorAll("body *")) {
        if (cut.length > 4) break;
        const rc = el.getBoundingClientRect();
        if (rc.width === 0 || el.children.length > 0 || !(el.textContent || "").trim()) continue;
        if (getComputedStyle(el).textOverflow === "ellipsis") continue;
        let box = null;
        for (let e = el.parentElement; e; e = e.parentElement) { const ox = getComputedStyle(e).overflowX; if (/(auto|scroll)/.test(ox)) { box = "scroll"; break; } if (/(hidden|clip)/.test(ox)) { box = e; break; } }
        if (!box || box === "scroll") continue;
        
        let anc = el.parentElement, ell = false; while (anc && anc !== box) { if (getComputedStyle(anc).textOverflow === "ellipsis") ell = true; anc = anc.parentElement; }
        if (ell) continue;
        const br = box.getBoundingClientRect();
        if (rc.right > br.right + 2 && rc.left < br.right) cut.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} cut at ${Math.round(br.right)} (ends ${Math.round(rc.right)}) "${el.textContent.trim().slice(0, 40)}"`);
      }
      const hrefs = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("/") && !h.startsWith("//"));
      return { scrollW: document.documentElement.scrollWidth, vw, over, cut, hrefs };
    });
    info.hrefs.forEach((h) => links.add(h.split("#")[0].split("?")[0]));
    out.push({ r, status, scrollW: info.scrollW, over: info.over, cut: info.cut, errors });
    if (info.over.length || info.cut.length || info.scrollW > info.vw) await p.screenshot({ path: `/tmp/sweep/${r.replace(/\//g, "_") || "home"}.png`, fullPage: true });
  } catch (e) { out.push({ r, status, error: String(e).slice(0, 200), errors }); }
  await p.close();
  console.log(r, status, out.at(-1).over?.length ?? "ERR");
}
const dead = [];
for (const l of (process.env.LINKS ? [...links].sort() : [])) {
  if (!l || l.startsWith("/api/")) continue;
  try { const res = await fetch(BASE + l, { redirect: "manual", signal: AbortSignal.timeout(180000) }); if (res.status >= 400) dead.push(`${res.status} ${l}`); } catch (e) { dead.push(`ERR ${l}`); }
}
writeFileSync("/tmp/sweep/result.json", JSON.stringify({ out, dead, linkCount: links.size }, null, 1));
await b.close();
console.log("DONE", links.size, "links", dead.length, "dead");
