import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { fetchThreats, label } from "@/lib/shield";
import { explorerAddress, short } from "@/lib/config";
import { Icon } from "@/components/Icons";
import { ScanLoader } from "@/components/Motif";
import { PreviewBadge } from "@/components/Preview";
import { TimeAgo } from "@/components/TimeAgo";

export const metadata: Metadata = { title: "Threat Board", description: "Drainers, malicious contracts and attack patterns Heimdall Shield is catching on Robinhood Chain, updated live." };


async function Board() {
  const t = await fetchThreats();
  const empty = !t || (t.codes.length === 0 && t.recent.length === 0);
  const codes = t?.codes.length ? t.codes : [["UNLIMITED_APPROVAL_TO_EOA", 0], ["PERMIT_TO_EOA", 0], ["HONEYPOT", 0], ["DRAINS_BALANCE", 0], ["BLIND_HASH_SIGNATURE", 0]].map(([code, count]) => ({ code: code as string, count: count as number }));
  const max = Math.max(1, ...codes.map((c) => c.count));
  return (
    <>
      {empty && <div className="flex items-center gap-3 rounded-xl border border-brand/20 bg-brand-soft/60 px-4 py-3 text-[14.5px]"><PreviewBadge />The board fills in from the first checks after launch. Nothing here is self-reported: every entry comes from a Shield simulation.</div>}
      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <section className="card p-6">
          <div className="mb-5 flex items-center justify-between"><h2 className="text-[18px] font-semibold">Most caught patterns</h2><span className="font-mono text-[12px] text-muted">last {t?.window ?? "7d"}</span></div>
          <ul className="flex flex-col gap-4">
            {codes.slice(0, 8).map((c) => (
              <li key={c.code}>
                <div className="mb-1.5 flex justify-between text-[14px]"><span className="font-medium">{label(c.code)}</span><span className="font-mono text-muted">{c.count.toLocaleString("en-US")}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-ink-2"><div className="h-full rounded-full bg-gradient-to-r from-[#F5A524] to-deny" style={{ width: `${empty ? 0 : Math.max(4, (c.count / max) * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-6">
          <div className="mb-5 flex items-center justify-between"><h2 className="text-[18px] font-semibold">Live denials</h2><span className="inline-flex items-center gap-1.5 text-[12px] text-muted"><span className="size-1.5 rounded-full bg-deny" />newest first</span></div>
          {t?.recent.length ? (
            <ul className="flex flex-col divide-y divide-line">
              {t.recent.slice(0, 10).map((r, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-3 text-[14px]">
                  <div className="min-w-0"><div className="font-medium">{label(r.codes[0] ?? "")}</div><div className="truncate font-mono text-[12px] text-muted">{r.target ? <a href={explorerAddress(r.target)} className="hover:text-brand">{short(r.target)}</a> : r.kind === "sig" ? "signature" : "—"}</div></div>
                  <span className="shrink-0 font-mono text-[12px] text-muted"><TimeAgo t={r.at} /></span>
                </li>
              ))}
            </ul>
          ) : <p className="py-8 text-center text-[14px] text-muted">No denials recorded yet.</p>}
        </section>
      </div>
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-6 py-4"><h2 className="text-[18px] font-semibold">Most denied addresses</h2><span className="text-[12px] text-muted">Targets and spenders behind denied checks</span></div>
        {t?.targets.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[14px]">
              <thead><tr className="bg-ice text-[12px] text-muted"><th className="px-6 py-3 font-medium">Address</th><th className="px-6 py-3 font-medium">Denied checks</th><th className="px-6 py-3 font-medium">Status</th></tr></thead>
              <tbody>{t.targets.slice(0, 15).map((x) => (
                <tr key={x.address} className="border-t border-line"><td className="px-6 py-3 font-mono"><a href={explorerAddress(x.address)} className="hover:text-brand">{x.address}</a></td><td className="px-6 py-3 font-mono">{x.denies}</td>
                  <td className="px-6 py-3">{x.blocklisted ? <span className="rounded-md bg-deny-soft px-2 py-0.5 text-[12px] font-semibold text-deny">Blocklisted</span> : <span className="text-[12px] text-muted">Pattern match</span>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="px-6 py-10 text-center text-[14px] text-muted">No denied addresses yet.</p>}
      </section>
      <section className="card p-6">
        <h2 className="text-[18px] font-semibold">Known malicious addresses</h2>
        <p className="mt-1 text-[14px] text-muted">Shield denies any transaction or signature that touches these. Report one: security@heimdall.fund.</p>
        {t?.blocklist.length ? (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">{t.blocklist.map((b) => <li key={b.address} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"><span className="truncate font-mono text-[13px]">{b.address}</span><span className="shrink-0 text-[12px] text-muted">{b.label ?? "reported"}</span></li>)}</ul>
        ) : <p className="mt-4 text-[14px] text-muted">The list is published with the launch.</p>}
      </section>
    </>
  );
}

export default function ThreatsPage() {
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-6 pb-24 pt-14">
      <header className="flex flex-wrap items-end justify-between gap-6 pb-2">
        <div className="max-w-[660px]">
          <span className="eyebrow">Threat Board</span>
          <h1 className="mt-2 text-[50px] md:text-[62px]">What Shield is catching on Robinhood Chain</h1>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">Live, aggregate data from Shield checks: the attack patterns agents run into, the addresses behind them, and the known drainers Shield blocks. No personal data, only what the simulation saw.</p>
        </div>
        <Link href="/app/shield" className="btn btn-primary">Check a transaction <Icon name="arrow" size={16} /></Link>
      </header>
      <Suspense fallback={<ScanLoader label="Loading the board…" />}><Board /></Suspense>
    </div>
  );
}
