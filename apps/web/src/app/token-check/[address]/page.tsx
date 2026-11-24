import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { ScanLoader } from "@/components/Motif";
import { explorerAddress, short, SHIELD_API_URL } from "@/lib/config";
import { TokenCheckForm } from "../TokenCheckForm";

type Leg = { ok: boolean; taxPct: number | null; reason?: string } | null;
type Report = {
  token: string; symbol: string | null; name: string | null; decimals: number | null; owner: string | null;
  verdict: "ALLOW" | "WARN" | "DENY"; riskScore: number; findings: { code: string; severity: "info" | "warn" | "deny"; message: string }[];
  pool: { version?: 3 | 4; address: string; fee: number; pair: string; liquidity: string; hooks?: string } | null; buy: Leg; sell: Leg; transfer: Leg; pullableBy: string[]; checkedAt: number;
};

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  return { title: `Token Check · ${isAddress(address) ? short(address) : "invalid"}`, description: "Simulated buy, sell and transfer of this Robinhood Chain token, with honeypot, tax, clawback and fake-ticker checks.", robots: { index: false } };
}

export default function Page({ params }: { params: Promise<{ address: string }> }) {
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-5 pb-16 pt-12 md:px-8">
      <Link href="/token-check" className="text-[14px] font-medium text-brand hover:underline">← Token Check</Link>
      <Suspense fallback={<div className="flex justify-center py-24"><ScanLoader label="Buying and selling it in a simulation…" /></div>}><Content params={params} /></Suspense>
    </div>
  );
}

const TONE = { ALLOW: ["border-allow/50 bg-allow-soft", "text-allow", "Looks tradable"], WARN: ["border-warn/50 bg-warn-soft", "text-warn", "Be careful"], DENY: ["border-deny/50 bg-deny-soft", "text-deny", "Do not buy"] } as const;
const SEV = { deny: "bg-deny", warn: "bg-warn", info: "bg-line-strong" } as const;

function LegCard({ title, leg, good, extra }: { title: string; leg: Leg; good: string; extra?: string }) {
  const state = leg === null ? "skip" : !leg.ok ? "bad" : (leg.taxPct ?? 0) >= 50 ? "bad" : (leg.taxPct ?? 0) >= 10 ? "warn" : "ok";
  const dot = { ok: "bg-allow", warn: "bg-warn", bad: "bg-deny", skip: "bg-line-strong" }[state];
  const text = leg === null ? "Not simulated" : !leg.ok ? `Fails${leg.reason ? `: ${leg.reason}` : ""}` : leg.taxPct ? `${leg.taxPct.toFixed(1)}% tax` : good;
  return (
    <div className="card flex min-w-0 flex-col gap-1.5 p-4">
      <span className="label">{title}</span>
      <span className="flex items-center gap-2 text-[16px] font-semibold"><span className={`size-2.5 shrink-0 rounded-full ${dot}`} /><span className="min-w-0 break-words">{text}</span></span>
      {extra && <span className="text-[12.5px] text-muted">{extra}</span>}
    </div>
  );
}

async function Content({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  const a = getAddress(address);
  await connection();
  const res = await fetch(`${SHIELD_API_URL}/v1/token/${a}`, { signal: AbortSignal.timeout(25_000), cache: "no-store" }).catch(() => null);
  const r = res?.ok ? ((await res.json()) as Report) : null;
  if (!r) {
    return (
      <section className="card flex flex-col gap-3 p-6">
        <h1 className="text-[28px]">Token Check could not finish</h1>
        <p className="text-muted">{res?.status === 402 || res?.status === 429 ? "You have used the free checks for now. Try again in a minute." : "Shield did not answer. Treat the token as unsafe until a check completes."}</p>
        <TokenCheckForm compact initial={a} />
      </section>
    );
  }
  const [box, color, head] = TONE[r.verdict];
  const notable = r.findings.filter((f) => f.severity !== "info");
  const info = r.findings.filter((f) => f.severity === "info");
  const pulled = r.pullableBy.length ? `${r.pullableBy.includes("anyone") ? "Anyone" : "The owner"} can take it from your wallet` : "No one could pull it without approval";
  return (
    <>
      <header className="flex flex-col gap-2">
        <span className="eyebrow">Token Check</span>
        <h1 className="text-[40px] leading-tight md:text-[50px]">{r.symbol ?? "Unknown token"}{r.name && r.name !== r.symbol ? <span className="text-muted"> · {r.name}</span> : null}</h1>
        <a href={explorerAddress(a)} target="_blank" rel="noopener" className="break-all font-mono text-[13px] text-muted hover:text-brand">{a}</a>
      </header>
      <section className={`flex flex-col gap-2 rounded-[3px] border p-5 sm:flex-row sm:items-center sm:gap-4 ${box}`}>
        <span className={`font-mono text-[28px] font-bold ${color}`}>{r.verdict}</span>
        <div className="min-w-0 flex-1"><p className={`text-[18px] font-semibold ${color}`}>{head}</p><p className="text-[14.5px] text-ink">{notable[0]?.message ?? "Buying, selling and moving it worked in the simulation, without a tax or a clawback."}</p></div>
        <span className="font-mono text-[13px] text-muted">risk {r.riskScore}/100</span>
      </section>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <LegCard title="Buy" leg={r.buy} good="Works, no tax" />
        <LegCard title="Sell" leg={r.sell} good="Works, no tax" />
        <LegCard title="Transfer" leg={r.transfer} good="Works, no tax" />
        <LegCard title="Clawback" leg={r.buy ? { ok: r.pullableBy.length === 0, taxPct: null, reason: r.pullableBy.length ? pulled.toLowerCase() : undefined } : null} good={pulled} />
      </section>
      {notable.length > 0 && (
        <section className="card flex flex-col gap-3 p-5">
          <h2 className="text-[18px] font-semibold">What Heimdall found</h2>
          <ul className="flex flex-col gap-2.5">{notable.map((f, i) => <li key={i} className="flex items-start gap-3 text-[15px] leading-relaxed"><span className={`mt-2 size-2 shrink-0 rounded-full ${SEV[f.severity]}`} /><span className="min-w-0">{f.message}</span></li>)}</ul>
        </section>
      )}
      <section className="grid gap-3 text-[14px] md:grid-cols-2">
        <div className="card flex flex-col gap-1.5 p-4">
          <span className="label">Pool</span>
          {r.pool ? (r.pool.version === 4 ? (
            <><span className="break-all font-mono text-[12.5px]">{r.pool.address.slice(0, 18)}…</span><span className="text-muted">Uniswap v4 · {r.pool.pair} · {r.pool.fee === 0x800000 ? "dynamic fee" : `${(r.pool.fee / 10_000).toFixed(2)}% fee`}{r.pool.hooks && !/^0x0{40}$/i.test(r.pool.hooks) ? <> · hook <a href={explorerAddress(r.pool.hooks)} target="_blank" rel="noopener" className="font-mono hover:text-brand">{short(r.pool.hooks)}</a></> : " · no hook"}</span></>
          ) : <><a href={explorerAddress(r.pool.address)} target="_blank" rel="noopener" className="font-mono hover:text-brand">{short(r.pool.address)}</a><span className="text-muted">Uniswap v3 · {r.pool.pair} · {(r.pool.fee / 10_000).toFixed(2)}% fee</span></>) : <span className="text-muted">No Uniswap v3 or v4 pool against ETH or WETH</span>}
        </div>
        <div className="card flex flex-col gap-1.5 p-4">
          <span className="label">Owner</span>
          {r.owner ? <a href={explorerAddress(r.owner)} target="_blank" rel="noopener" className="font-mono hover:text-brand">{short(r.owner)}</a> : <span className="text-muted">None, or not exposed by owner()</span>}
          {info.filter((f) => f.code !== "HAS_OWNER").map((f, i) => <span key={i} className="text-muted">{f.message}</span>)}
        </div>
      </section>
      <p className="text-[13px] text-muted">Simulated on the Robinhood Chain block at {new Date(r.checkedAt).toISOString().slice(0, 16).replace("T", " ")} UTC with a throwaway wallet. A clean result shows what the token does now, not what its owner can change later.</p>
      <section className="flex flex-col gap-3 border-t border-line pt-6"><h2 className="text-[18px] font-semibold">Check another token</h2><TokenCheckForm compact /></section>
    </>
  );
}
