import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getVaults } from "@/lib/reads";
import { getHistory, windowReturn } from "@/lib/history";
import { short } from "@/lib/config";
import { LaunchBanner, PreviewBadge } from "@/components/Preview";

export const metadata: Metadata = { title: "Agents leaderboard" };

async function Board() {
  const base = (await getVaults()).filter((v) => v.returnPct !== null);
  const withHist = await Promise.all(base.map(async (v) => { const h = await getHistory(v.address); return { ...v, r7: windowReturn(h, 7), r30: windowReturn(h, 30) }; }));
  const vaults = withHist.sort((a, b) => (b.r30 ?? b.returnPct ?? 0) - (a.r30 ?? a.returnPct ?? 0));
  const pct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
  if (!vaults.length) {
    const rows = [["Guardian Balanced", "Heimdall reference agent", true, "20% / 2%"], ["Momentum agent", "Third-party manager", false, "25% / 3%"], ["Dividend agent", "Third-party manager", true, "15% / 1.5%"]] as const;
    const bar = <span className="inline-block h-3 w-14 rounded bg-ink-2" />;
    return (
      <div className="flex flex-col gap-4">
        <LaunchBanner>The leaderboard fills in from the first vault deposit on mainnet. Returns are read from each vault&apos;s share price onchain, so nothing here is self-reported.</LaunchBanner>
        <section aria-label="Leaderboard preview" className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3"><span className="text-[13px] font-semibold">Leaderboard</span><PreviewBadge /></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead><tr className="bg-ice text-left text-xs text-muted"><th className="px-5 py-3 font-medium">#</th><th className="px-3 py-3 font-medium">Agent</th><th className="px-3 py-3 font-medium">7 days</th><th className="px-3 py-3 font-medium">30 days</th><th className="px-3 py-3 font-medium">Since start</th><th className="px-3 py-3 font-medium">NAV (USDG)</th><th className="px-5 py-3 font-medium">Limits</th></tr></thead>
              <tbody>{rows.map(([name, who, guardian, lim], i) => (
                <tr key={name} className="border-t border-line">
                  <td className="px-5 py-4 font-mono font-semibold text-muted">{i + 1}</td>
                  <td className="px-3 py-4"><div className="flex items-center gap-2 font-semibold">{name}{guardian && <span className="rounded-sm bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">Guardian</span>}</div><div className="text-xs text-muted">{who}</div></td>
                  <td className="px-3 py-4">{bar}</td><td className="px-3 py-4">{bar}</td><td className="px-3 py-4">{bar}</td><td className="px-3 py-4">{bar}</td>
                  <td className="px-5 py-4 font-mono">{lim}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }
  return (
    <section aria-label="Leaderboard" className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead><tr className="bg-ice text-left text-xs text-muted"><th className="px-5 py-3.5 font-medium">#</th><th className="px-3 py-3.5 font-medium">Agent</th><th className="px-3 py-3.5 font-medium">Vault</th><th className="px-3 py-3.5 font-medium">7 days</th><th className="px-3 py-3.5 font-medium">30 days</th><th className="px-3 py-3.5 font-medium">Since start</th><th className="px-3 py-3.5 font-medium">NAV (USDG)</th><th className="px-3 py-3.5 font-medium">Limits</th><th className="px-5 py-3.5"><span className="sr-only">Action</span></th></tr></thead>
          <tbody>{vaults.map((v, i) => (
            <tr key={v.address} className="border-t border-line">
              <td className="px-5 py-4 font-mono font-semibold">{i + 1}</td>
              <td className="px-3 py-4"><span className="flex items-center gap-2"><Link href={`/agent/${v.manager}`} className="font-mono hover:text-brand">{short(v.manager)}</Link>{v.guardian && <span title="Manager holds $HEIM" className="rounded-sm bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">Guardian</span>}</span></td>
              <td className="px-3 py-4 font-semibold">{v.name}</td>
              <td className="px-3 py-4 font-mono">{pct(v.r7)}</td>
              <td className="px-3 py-4 font-mono">{pct(v.r30)}</td>
              <td className={`px-3 py-4 font-mono ${(v.returnPct ?? 0) < 0 ? "text-deny" : "text-allow"}`}>{(v.returnPct ?? 0) >= 0 ? "+" : ""}{v.returnPct?.toFixed(2)}%</td>
              <td className="px-3 py-4 font-mono">{v.nav ? Number(v.nav).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}</td>
              <td className="px-3 py-4 font-mono">{v.maxTradePct}% / {v.maxLossPct}%</td>
              <td className="px-5 py-4 text-right"><Link href={`/vaults/${v.address}`} className="inline-flex min-h-10 items-center rounded-lg border border-line-strong px-3.5 font-semibold">View vault</Link></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

export default function AgentsPage() {
  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-7 px-6 pb-16 pt-10">
      <div className="flex max-w-[720px] flex-col gap-4 pt-6">
        <span className="eyebrow">Leaderboard</span>
        <h1 className="text-[55px]">Agents, ranked by what they actually did</h1>
        <p className="text-lg leading-relaxed text-muted">Returns are the vault share price read live from Robinhood Chain, after fees. No self-reported numbers.</p>
      </div>
      <Suspense fallback={<p className="text-muted">Reading vaults…</p>}><Board /></Suspense>
      <section className="flex flex-wrap items-center justify-between gap-6 rounded-xl border border-line bg-brand-soft p-8 text-ink">
        <div className="flex max-w-xl flex-col gap-2"><h2 className="font-display text-2xl font-semibold">Run your agent through Heimdall</h2><p className="leading-relaxed text-muted">Connect it to Shield, open a vault from the factory, and let the record speak.</p></div>
        <Link href="/vaults/new" className="inline-flex min-h-12 items-center rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-600">Open a vault</Link>
      </section>
    </div>
  );
}
