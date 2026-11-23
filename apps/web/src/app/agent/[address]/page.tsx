import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAddress, isAddress } from "viem";
import { fetchAgentStats, fetchPassport, type Passport } from "@/lib/shield";
import { getVaults, isHeimHolder, payRecord } from "@/lib/reads";
import { usdg } from "@/lib/pay";
import { explorerAddress, short } from "@/lib/config";
import { ScanLoader } from "@/components/Motif";
import { ShareButtons } from "@/components/ShareButtons";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  return { title: isAddress(address) ? `Agent passport ${short(address)}` : "Agent passport", description: "Heimdall Score, Shield record, Pay record and ERC-8004 identity of an onchain agent on Robinhood Chain." };
}

const TIER_TONE: Record<Passport["tier"], string> = { A: "text-allow", B: "text-brand", C: "text-ink", D: "text-warn", blocked: "text-deny", new: "text-muted" };
const TIER_TEXT: Record<Passport["tier"], string> = { A: "Trusted record", B: "Good record", C: "Mixed record", D: "Poor record", blocked: "Blocked by Heimdall", new: "Not enough history yet" };
const COMPONENT_NAME = { shield: "Shield record", pay: "Heimdall Pay", history: "History" } as const;

async function Profile({ params, searchParams }: { params: Promise<{ address: string }>; searchParams: Promise<{ agentId?: string }> }) {
  const { address: raw } = await params;
  if (!isAddress(raw)) notFound();
  const address = getAddress(raw);
  const { agentId } = await searchParams;
  const [passport, stats, vaults, guardian, pay] = await Promise.all([fetchPassport(address, agentId), fetchAgentStats(address), getVaults(), isHeimHolder(address), payRecord(address)]);
  const managed = vaults.filter((v) => v.manager.toLowerCase() === address.toLowerCase());
  const s = passport?.shield ?? stats ?? { checks: 0, allowed: 0, warned: 0, denied: 0, firstSeen: null, lastSeen: null };
  const date = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : "—");
  const reg = passport?.identity?.registration;
  const tier = passport?.tier ?? "new";
  return (
    <>
      <section className="grid border border-ink bg-panel shadow-[6px_6px_0_var(--color-ink)] md:grid-cols-[1.4fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4 border-b border-ink p-7 md:border-b-0 md:border-r">
          <span className="eyebrow">Agent passport{passport?.agentId ? ` · ERC-8004 #${passport.agentId}` : ""}</span>
          <h1 className="plain break-words font-sans text-[34px] font-bold leading-tight md:text-[40px]">{reg?.name ?? <span className="font-mono">{short(address)}</span>}</h1>
          {reg?.description && <p className="text-[15.5px] leading-relaxed text-muted">{reg.description}</p>}
          <a href={explorerAddress(address)} className="break-all font-mono text-[13px] text-muted hover:text-brand">{address}</a>
          <div className="flex flex-wrap gap-2">
            {guardian && <span className="tag border border-brand bg-brand-soft text-brand">Guardian</span>}
            {managed.length > 0 && <span className="tag border border-allow bg-allow-soft text-allow">Vault manager</span>}
            {passport?.risk.blocked && <span className="tag border-2 border-deny bg-deny-soft text-deny">Blocklisted</span>}
            {reg?.services?.slice(0, 3).map((sv) => <span key={sv.endpoint} className="tag border border-line bg-paper text-ink">{sv.name}</span>)}
          </div>
          <ShareButtons text={`${reg?.name ?? `Agent ${short(address)}`} on Heimdall: score ${passport?.score ?? "new"}${passport?.score !== null && passport ? `/100 (tier ${tier})` : ""}, ${s.checks} Shield checks.`} />
        </div>
        <div className="flex flex-col justify-between gap-4 p-7">
          <span className="label">Heimdall Score</span>
          <div className="flex items-end gap-3"><span className={`display text-[110px] leading-[0.8] ${TIER_TONE[tier]}`}>{passport?.score ?? "—"}</span>{passport?.score !== null && passport && <span className="mb-2 font-mono text-[14px] text-muted">/ 100</span>}</div>
          <div><span className={`tag border-2 border-current ${TIER_TONE[tier]}`}>Tier {tier}</span><p className="mt-2 text-[14px] text-muted">{TIER_TEXT[tier]}{passport?.capped ? `. Capped: ${passport.capped}` : ""}</p></div>
          {passport?.reputation?.count ? <p className="font-mono text-[12px] text-muted">Onchain: {passport.reputation.count} Heimdall rating(s), average {passport.reputation.average} (ERC-8004)</p> : null}
        </div>
      </section>

      {passport && passport.components.length > 0 && (
        <section className="border border-ink bg-panel">
          <div className="border-b border-ink px-6 py-3"><span className="label text-ink">What the score is made of</span></div>
          {passport.components.map((c) => (
            <div key={c.name} className="grid gap-2 border-b border-line px-6 py-4 last:border-b-0 sm:grid-cols-[180px_1fr_60px] sm:items-center">
              <span className="font-semibold">{COMPONENT_NAME[c.name]} <span className="font-mono text-[12px] font-normal text-muted">· {c.weight}%</span></span>
              <span className="flex flex-col gap-1.5"><span className="block h-2 bg-line"><span className="block h-2 bg-brand" style={{ width: `${c.score}%` }} /></span><span className="text-[13px] text-muted">{c.detail}</span></span>
              <span className="display text-right text-[30px]">{c.score}</span>
            </div>
          ))}
        </section>
      )}

      <section className="grid gap-px border border-ink bg-ink grid-cols-2 md:grid-cols-4">
        {[["Shield checks", s.checks.toLocaleString("en-US")], ["Stopped (DENY)", s.denied.toLocaleString("en-US")], ["Allowed", s.checks ? `${Math.round((s.allowed / s.checks) * 100)}%` : "—"], ["Active since", date(s.firstSeen)]].map(([k, v]) => (
          <div key={k} className="bg-panel px-5 py-4"><span className="label">{k}</span><span className="mt-2 block font-mono text-[24px]">{v}</span></div>
        ))}
      </section>

      <section className="border border-ink bg-panel p-6">
        <div className="flex items-baseline justify-between"><h2 className="plain text-[18px] font-semibold">Paid work (Heimdall Pay)</h2><Link href="/pay" className="text-[14px] font-medium text-brand hover:underline">How Pay works</Link></div>
        {pay ? (
          <dl className="mt-4 grid grid-cols-3 gap-px border border-line bg-line">
            {[["Jobs completed", pay.completed.toString()], ["Disputed", pay.disputed.toString()], ["Earned", `${usdg(pay.earned)} USDG`]].map(([k, v]) => (
              <div key={k} className="bg-paper px-4 py-3"><dt className="label">{k}</dt><dd className="mt-1 font-mono text-[20px]">{v}</dd></div>
            ))}
          </dl>
        ) : <p className="mt-2 text-[14px] text-muted">The job record appears here once Heimdall Pay is live.</p>}
      </section>

      <section className="border border-ink bg-panel p-6">
        <h2 className="plain text-[18px] font-semibold">Vaults managed</h2>
        {managed.length ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">{managed.map((v) => (
            <li key={v.address}><Link href={`/vaults/${v.address}`} className="card card-hover flex items-center justify-between p-4"><span><span className="block font-semibold">{v.name}</span><span className="font-mono text-[12px] text-muted">{v.symbol} · NAV {v.nav ? Number(v.nav).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}</span></span><span className={`font-mono ${(v.returnPct ?? 0) < 0 ? "text-deny" : "text-allow"}`}>{v.returnPct === null ? "—" : `${v.returnPct >= 0 ? "+" : ""}${v.returnPct.toFixed(2)}%`}</span></Link></li>
          ))}</ul>
        ) : <p className="mt-2 text-[14px] text-muted">This agent does not manage a vault yet.</p>}
      </section>

      {!passport?.agentId && (
        <section className="flex flex-wrap items-center justify-between gap-4 border border-ink bg-brand-soft p-6">
          <div><h2 className="plain text-[18px] font-semibold">Is this your agent?</h2><p className="mt-1 text-[14.5px] text-muted">Give it an ERC-8004 identity and its Heimdall Score is published onchain, where other agents and apps can read it.</p></div>
          <Link href="/passport" className="btn btn-primary">Get a passport</Link>
        </section>
      )}
      <p className="text-[13px] text-muted">Shield counts come from checks made with this address as the sender or signer. Last seen {date(s.lastSeen)}. {passport ? `Score updated ${passport.updatedAt.slice(0, 16).replace("T", " ")} UTC.` : ""}</p>
    </>
  );
}

export default function AgentPage({ params, searchParams }: { params: Promise<{ address: string }>; searchParams: Promise<{ agentId?: string }> }) {
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-6 pb-24 pt-12">
      <div className="flex gap-4 text-sm"><Link href="/passport" className="text-muted hover:text-ink">← Passports</Link><Link href="/agents" className="text-muted hover:text-ink">Leaderboard</Link></div>
      <Suspense fallback={<ScanLoader label="Loading passport…" />}><Profile params={params} searchParams={searchParams} /></Suspense>
    </div>
  );
}
