import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { VerdictBadge } from "@/components/Verdict";
import { Icon } from "@/components/Icons";
import { ScanLoader } from "@/components/Motif";
import { ShareButtons } from "@/components/ShareButtons";
import { fetchVerdict, headline, label, verdictTitle } from "@/lib/shield";
import { explorerAddress, short } from "@/lib/config";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const v = /^0x[0-9a-fA-F]{64}$/.test(id) ? await fetchVerdict(id) : null;
  if (!v) return { title: "Shield verdict" };
  return { title: `${v.result.verdict}: ${verdictTitle(v.result)}`, description: v.result.findings.map((f) => f.message).slice(0, 2).join(" ") || "Checked by Heimdall Shield on Robinhood Chain." };
}

const dot = { deny: "bg-deny", warn: "bg-[#D99A00]", info: "bg-[#9AA3B5]" } as Record<string, string>;
const tone = { DENY: "from-[#FDE8E9]", WARN: "from-[#FFF4DB]", ALLOW: "from-[#E6F6EC]" };

async function Verdict({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) notFound();
  const v = await fetchVerdict(id);
  if (!v) notFound();
  const r = v.result;
  const top = r.findings.find((f) => f.severity === "deny") ?? r.findings.find((f) => f.severity === "warn");
  const rest = r.findings.filter((f) => f !== top);
  const when = new Date(v.at).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return (
    <>
      <div className={`card overflow-hidden bg-gradient-to-b ${tone[r.verdict]} to-white to-40%`}>
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:p-8">
          <div className="flex items-center justify-between gap-3 sm:order-last sm:flex-col sm:items-end sm:gap-2">
            <span className="eyebrow sm:hidden">Shield verdict</span>
            <div className="flex flex-col items-end gap-1.5"><VerdictBadge kind={r.verdict} size="lg" /><span className="font-mono text-[13px] text-muted">risk {r.riskScore}/100</span></div>
          </div>
          <div className="min-w-0 flex-1">
            <span className="eyebrow hidden sm:inline-flex">Shield verdict · {v.kind === "tx" ? "transaction" : "signature"}</span>
            <h1 className="mt-1 text-[28px] leading-[1.1] sm:mt-3 sm:text-[36px] md:text-[44px]">{verdictTitle(r)}</h1>
            <p className="mt-3 break-words text-[15.5px] leading-relaxed">{headline(r)}</p>
            {r.summary.slice(0, 2).filter((s) => s !== headline(r)).map((s) => <p key={s} className="mt-1.5 break-words text-[14.5px] text-muted">{s}</p>)}
          </div>
        </div>
        {rest.length > 0 && (
          <ul className="flex flex-col gap-3 border-t border-line bg-panel px-5 py-5 sm:px-8 sm:py-6">
            {rest.map((f) => (
              <li key={f.code} className="flex gap-3"><span className={`mt-[7px] size-2.5 shrink-0 rounded-full ${dot[f.severity] ?? dot.info}`} /><div className="min-w-0"><div className="font-semibold">{label(f.code).charAt(0).toUpperCase() + label(f.code).slice(1)}</div><div className="break-words text-[14.5px] text-muted">{f.message}</div></div></li>
            ))}
          </ul>
        )}
        <dl className="grid grid-cols-2 gap-px border-t border-line bg-line text-[14px]">
          {v.tx && <>
            <div className="bg-panel px-5 py-3.5 sm:px-8 sm:py-4"><dt className="text-[12px] text-muted">From</dt><dd className="mt-1 font-mono"><Link className="hover:text-brand" href={`/agent/${v.tx.from}`}>{short(v.tx.from)}</Link></dd></div>
            <div className="bg-panel px-5 py-3.5 sm:px-8 sm:py-4"><dt className="text-[12px] text-muted">To</dt><dd className="mt-1 font-mono">{v.tx.to ? <a className="hover:text-brand" href={explorerAddress(v.tx.to)}>{short(v.tx.to)}</a> : "contract creation"}</dd></div>
          </>}
          {v.signer && <div className="bg-panel px-5 py-3.5 sm:px-8 sm:py-4"><dt className="text-[12px] text-muted">Signer · type</dt><dd className="mt-1 font-mono">{short(v.signer)} · {v.primaryType}</dd></div>}
          <div className="col-span-2 bg-panel px-5 py-3.5 sm:col-span-1 sm:px-8 sm:py-4"><dt className="text-[12px] text-muted">Checked</dt><dd className="mt-1 font-mono">{when} · Robinhood Chain</dd></div>
          <div className="col-span-2 bg-panel px-5 py-3.5 sm:col-span-1 sm:px-8 sm:py-4"><dt className="text-[12px] text-muted">Check ID</dt><dd className="mt-1 truncate font-mono">{short(id)}</dd></div>
        </dl>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ShareButtons text={`Heimdall Shield says ${r.verdict}: ${verdictTitle(r)}`} />
        <Link href="/app/shield" className="btn btn-primary">Check your own transaction <Icon name="arrow" size={16} /></Link>
      </div>
      <p className="text-[13px] text-muted">A verdict is an automated simulation on the block it was checked against, not a guarantee. Signed receipts are never published on share pages.</p>
    </>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-6 px-6 pb-24 pt-12">
      <Suspense fallback={<ScanLoader label="Loading verdict…" />}><Verdict params={params} /></Suspense>
    </div>
  );
}
