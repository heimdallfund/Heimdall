import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { isAddress, type Address } from "viem";
import { getVault } from "@/lib/reads";
import { explorerAddress, explorerTx, short } from "@/lib/config";
import { TokenIcon } from "@/components/TokenIcon";
import { DepositPanel } from "./DepositPanel";
import { Providers } from "@/components/Providers";
import { NavChart } from "@/components/NavChart";
import { getDecisions, getHistory, windowReturn } from "@/lib/history";

export const metadata: Metadata = { title: "Vault" };

const num = (v: string | null, d = 2) => (v === null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d }));

async function VaultDetail({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  const data = await getVault(address as Address);
  if (!data) notFound();
  const { vault: v, positions } = data;
  const [history, decisions] = await Promise.all([getHistory(v.address), getDecisions(v.address)]);
  const r7 = windowReturn(history, 7), r30 = windowReturn(history, 30);
  const pct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
  const nav = v.nav === null ? null : Number(v.nav);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap gap-2"><span className="rounded-md bg-allow-soft px-2 py-1 text-xs font-semibold text-allow">Shield-guarded</span><span className="rounded-md bg-[#EEF2F7] px-2 py-1 text-xs font-semibold text-[#3A4560]">Base asset USDG</span></div>
          <h1 className="font-display text-[42px]">{v.name}</h1>
          <span className="text-[15px] text-muted">Managed by agent <a className="font-mono text-ink hover:text-violet-ink" href={explorerAddress(v.manager)}>{short(v.manager)}</a> · <a className="hover:text-violet-ink" href={explorerAddress(v.address)}>contract {short(v.address)}</a></span>
        </div>
        <dl className="grid grid-cols-2 gap-7 sm:grid-cols-4">
          <div><dt className="text-xs text-muted">NAV (USDG)</dt><dd className="mt-1 font-mono text-[22px]">{num(v.nav)}</dd></div>
          <div><dt className="text-xs text-muted">Share price</dt><dd className="mt-1 font-mono text-[22px]">{num(v.sharePrice, 4)}</dd></div>
          <div><dt className="text-xs text-muted">Since start</dt><dd className={`mt-1 font-mono text-[22px] ${v.returnPct !== null && v.returnPct < 0 ? "text-deny" : "text-allow"}`}>{v.returnPct === null ? "—" : `${v.returnPct >= 0 ? "+" : ""}${v.returnPct.toFixed(2)}%`}</dd></div>
          <div><dt className="text-xs text-muted">Limits</dt><dd className="mt-1 font-mono text-[22px]">{v.maxTradePct}% / {v.maxLossPct}%</dd></div>
        </dl>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-6">
          <section aria-labelledby="navh" className="card p-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="navh" className="text-lg font-semibold">Share price (USDG)</h2>
              <span className="flex gap-5 text-sm"><span><span className="text-muted">7 days </span><span className="font-mono">{pct(r7)}</span></span><span><span className="text-muted">30 days </span><span className="font-mono">{pct(r30)}</span></span></span>
            </div>
            <NavChart points={history} />
          </section>
          <section aria-labelledby="pos" className="card p-6">
            <h2 id="pos" className="mb-4 text-lg font-semibold">Positions</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="px-2 py-2.5 font-medium">Asset</th><th className="px-2 py-2.5 font-medium">Amount</th><th className="px-2 py-2.5 font-medium">Value (USDG)</th><th className="px-2 py-2.5 font-medium">Weight</th></tr></thead>
                <tbody>{positions.map((p) => (
                  <tr key={p.token} className="border-t border-line">
                    <td className="px-2 py-3"><span className="inline-flex items-center gap-2.5"><TokenIcon symbol={p.symbol} /><span className="font-semibold">{p.symbol}</span></span></td>
                    <td className="px-2 py-3 font-mono">{num(p.amount, 6)}</td>
                    <td className="px-2 py-3 font-mono">{num(p.value)}</td>
                    <td className="px-2 py-3 font-mono">{nav && p.value !== null ? `${((Number(p.value) / nav) * 100).toFixed(1)}%` : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
          <section aria-labelledby="log" className="card p-6">
            <h2 id="log" className="text-lg font-semibold">Agent decision log</h2>
            <p className="mb-4 mt-1.5 text-sm text-muted">Every trade the agent executed, with the Shield check that allowed it and the vault value before and after.</p>
            {decisions.length === 0 ? <p className="text-sm text-muted">No trades yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-sm">
                  <thead><tr className="text-left text-xs text-muted"><th className="px-2 py-2.5 font-medium">Time (UTC)</th><th className="px-2 py-2.5 font-medium">Action</th><th className="px-2 py-2.5 font-medium">NAV before → after</th><th className="px-2 py-2.5 font-medium">Shield check</th><th className="px-2 py-2.5 font-medium">Tx</th></tr></thead>
                  <tbody>{decisions.map((d) => (
                    <tr key={d.tx + d.checkId} className="border-t border-line">
                      <td className="px-2 py-3 font-mono text-[13px]">{new Date(d.time).toISOString().slice(0, 16).replace("T", " ")}</td>
                      <td className="px-2 py-3"><span className="inline-flex items-center gap-2"><span className="rounded-md bg-allow-soft px-2 py-0.5 text-[11px] font-semibold text-allow">ALLOW</span>{d.action} · <span className="font-mono text-[13px] text-muted">{short(d.target)}</span></span></td>
                      <td className="px-2 py-3 font-mono text-[13px]">{d.navBefore.toLocaleString("en-US", { maximumFractionDigits: 2 })} → {d.navAfter.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                      <td className="px-2 py-3 font-mono text-[13px]">{short(d.checkId)}</td>
                      <td className="px-2 py-3"><a className="font-mono text-[13px] text-brand" href={explorerTx(d.tx)}>{short(d.tx)}</a></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </div>
        <aside className="flex min-w-0 flex-[1_1_360px] flex-col gap-6">
          <Providers><DepositPanel vault={v.address} maxLossPct={v.maxLossPct} maxDailyLossPct={v.maxDailyLossPct} /></Providers>
          <section className="flex flex-col gap-3 card p-6 text-sm">
            <h2 className="text-lg font-semibold">Guard rules (onchain)</h2>
            <div className="flex justify-between gap-3"><span className="text-muted">Shield receipt</span><span className="font-semibold">Required for every trade</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted">Max per trade</span><span className="font-mono">{v.maxTradePct}% of NAV</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted">Max loss per trade</span><span className="font-mono">{v.maxLossPct}%</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted">Max loss per day</span><span className="font-mono">{v.maxDailyLossPct}% of NAV</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted">Exit in kind</span><span className="font-semibold text-allow">Always</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted">Agent can withdraw</span><span className="font-semibold text-deny">Never</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted">Performance fee</span><span className="font-mono">15% of new profit</span></div>
          </section>
          <p className="text-xs leading-relaxed text-muted">Stock tokens are not available in every country and give no shareholder rights. Agents can lose money. Read the <Link className="underline" href="/legal/risk">risk disclosure</Link> before depositing.</p>
        </aside>
      </div>
    </>
  );
}

export default function VaultPage({ params }: { params: Promise<{ address: string }> }) {
  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-6 px-6 pb-16 pt-8">
      <Link href="/vaults" className="text-sm text-muted hover:text-ink">← All vaults</Link>
      <Suspense fallback={<p className="text-muted">Reading vault from Robinhood Chain…</p>}>
        <VaultDetail params={params} />
      </Suspense>
    </div>
  );
}
