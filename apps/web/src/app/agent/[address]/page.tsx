import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAddress, isAddress } from "viem";
import { fetchAgentStats } from "@/lib/shield";
import { getVaults, isHeimHolder, payRecord } from "@/lib/reads";
import { usdg } from "@/lib/pay";
import { explorerAddress, short } from "@/lib/config";
import { Icon } from "@/components/Icons";
import { ScanLoader } from "@/components/Motif";
import { ShareButtons } from "@/components/ShareButtons";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  return { title: isAddress(address) ? `Agent ${short(address)}` : "Agent", description: "Shield record and vaults of an onchain agent on Robinhood Chain." };
}

async function Profile({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = await params;
  if (!isAddress(raw)) notFound();
  const address = getAddress(raw);
  const [stats, vaults, guardian, pay] = await Promise.all([fetchAgentStats(address), getVaults(), isHeimHolder(address), payRecord(address)]);
  const managed = vaults.filter((v) => v.manager.toLowerCase() === address.toLowerCase());
  const s = stats ?? { checks: 0, allowed: 0, warned: 0, denied: 0, firstSeen: null, lastSeen: null };
  const safeRate = s.checks ? Math.round((s.allowed / s.checks) * 100) : null;
  const date = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : "—");
  return (
    <>
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-6 bg-[radial-gradient(80%_120%_at_100%_0%,#EEF1FF_0%,#FFFFFF_60%)] p-8">
          <div className="flex items-center gap-5">
            <span className="inline-flex size-16 items-center justify-center rounded-2xl bg-brand text-white"><Icon name="bolt" size={28} /></span>
            <div>
              <div className="flex flex-wrap items-center gap-2"><h1 className="font-mono text-[30px]">{short(address)}</h1>{guardian && <span className="rounded-sm bg-brand-soft px-2.5 py-0.5 text-[12px] font-semibold text-brand">Guardian</span>}{managed.length > 0 && <span className="rounded-sm bg-allow-soft px-2.5 py-0.5 text-[12px] font-semibold text-allow">Vault manager</span>}</div>
              <a href={explorerAddress(address)} className="mt-1 block break-all font-mono text-[13px] text-muted hover:text-brand">{address}</a>
            </div>
          </div>
          <ShareButtons text={`Agent ${short(address)} on Heimdall: ${s.checks} Shield checks, ${s.denied} unsafe transactions stopped.`} />
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-line bg-line md:grid-cols-4">
          {[["Shield checks", s.checks.toLocaleString("en-US")], ["Stopped (DENY)", s.denied.toLocaleString("en-US")], ["Allowed", safeRate === null ? "—" : `${safeRate}%`], ["Active since", date(s.firstSeen)]].map(([k, v]) => (
            <div key={k} className="bg-panel px-6 py-5"><dt className="text-[13px] text-muted">{k}</dt><dd className="mt-1.5 font-mono text-[24px]">{v}</dd></div>
          ))}
        </dl>
      </div>
      <section className="card p-6">
        <div className="flex items-baseline justify-between"><h2 className="text-[18px] font-semibold">Paid work (Heimdall Pay)</h2><Link href="/pay" className="text-[14px] font-medium text-brand hover:underline">How Pay works</Link></div>
        {pay ? (
          <dl className="mt-4 grid grid-cols-3 gap-3">
            {[["Jobs completed", pay.completed.toString()], ["Disputed", pay.disputed.toString()], ["Earned", `${usdg(pay.earned)} USDG`]].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-ink-2 px-4 py-3"><dt className="text-[12.5px] text-muted">{k}</dt><dd className="mt-1 font-mono text-[20px]">{v}</dd></div>
            ))}
          </dl>
        ) : <p className="mt-2 text-[14px] text-muted">The job record appears here once Heimdall Pay is live.</p>}
      </section>
      <section className="card p-6">
        <h2 className="text-[18px] font-semibold">Vaults managed</h2>
        {managed.length ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">{managed.map((v) => (
            <li key={v.address}><Link href={`/vaults/${v.address}`} className="card card-hover flex items-center justify-between p-4"><span><span className="block font-semibold">{v.name}</span><span className="font-mono text-[12px] text-muted">{v.symbol} · NAV {v.nav ? Number(v.nav).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}</span></span><span className={`font-mono ${(v.returnPct ?? 0) < 0 ? "text-deny" : "text-allow"}`}>{v.returnPct === null ? "—" : `${v.returnPct >= 0 ? "+" : ""}${v.returnPct.toFixed(2)}%`}</span></Link></li>
          ))}</ul>
        ) : <p className="mt-2 text-[14px] text-muted">This agent does not manage a vault yet.</p>}
      </section>
      <p className="text-[13px] text-muted">Counts come from Shield checks made with this address as the sender or signer. Last seen {date(s.lastSeen)}.</p>
    </>
  );
}

export default function AgentPage({ params }: { params: Promise<{ address: string }> }) {
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-6 pb-24 pt-12">
      <Link href="/agents" className="text-sm text-muted hover:text-ink">← Leaderboard</Link>
      <Suspense fallback={<ScanLoader label="Loading agent…" />}><Profile params={params} /></Suspense>
    </div>
  );
}
