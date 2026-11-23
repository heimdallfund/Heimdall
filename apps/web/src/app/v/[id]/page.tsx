import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { VerdictBadge } from "@/components/Verdict";
import { Icon } from "@/components/Icons";
import { ScanLoader } from "@/components/Motif";
import { ShareButtons } from "@/components/ShareButtons";
import { fetchVerdict, headline, label } from "@/lib/shield";
import { explorerAddress, short } from "@/lib/config";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const v = /^0x[0-9a-fA-F]{64}$/.test(id) ? await fetchVerdict(id) : null;
  if (!v) return { title: "Shield verdict" };
  return { title: `${v.result.verdict}: ${headline(v.result)}`, description: v.result.findings.map((f) => f.message).slice(0, 2).join(" ") || "Checked by Heimdall Shield on Robinhood Chain." };
}

const dot = { deny: "bg-deny", warn: "bg-[#D99A00]", info: "bg-[#9AA3B5]" } as Record<string, string>;
const tone = { DENY: "from-[#FDE8E9]", WARN: "from-[#FFF4DB]", ALLOW: "from-[#E6F6EC]" };

async function Verdict({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) notFound();
  const v = await fetchVerdict(id);
  if (!v) notFound();
  const r = v.result;
  const when = new Date(v.at).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return (
    <>
      <div className={`card overflow-hidden bg-gradient-to-b ${tone[r.verdict]} to-white to-40%`}>
        <div className="flex flex-wrap items-start justify-between gap-6 p-8">
          <div className="min-w-0 flex-1">
            <span className="eyebrow">Shield verdict · {v.kind === "tx" ? "transaction" : "signature"}</span>
            <h1 className="mt-3 text-[35px] md:text-[44px]">{headline(r)}</h1>
            {r.summary.slice(0, 2).map((s) => <p key={s} className="mt-1.5 text-[15px] text-muted">{s}</p>)}
          </div>
          <div className="flex flex-col items-end gap-2"><VerdictBadge kind={r.verdict} size="lg" /><span className="font-mono text-[13px] text-muted">risk {r.riskScore}/100</span></div>
        </div>
        {r.findings.length > 0 && (
          <ul className="flex flex-col gap-3 border-t border-line bg-panel px-8 py-6">
            {r.findings.map((f) => (
              <li key={f.code} className="flex gap-3"><span className={`mt-[7px] size-2.5 shrink-0 rounded-full ${dot[f.severity] ?? dot.info}`} /><div><div className="font-semibold">{label(f.code)}</div><div className="text-[14.5px] text-muted">{f.message}</div></div></li>
            ))}
          </ul>
        )}
        <dl className="grid gap-px border-t border-line bg-line text-[14px] sm:grid-cols-2">
          {v.tx && <>
            <div className="bg-panel px-8 py-4"><dt className="text-[12px] text-muted">From</dt><dd className="mt-1 font-mono"><Link className="hover:text-brand" href={`/agent/${v.tx.from}`}>{short(v.tx.from)}</Link></dd></div>
            <div className="bg-panel px-8 py-4"><dt className="text-[12px] text-muted">To</dt><dd className="mt-1 font-mono">{v.tx.to ? <a className="hover:text-brand" href={explorerAddress(v.tx.to)}>{short(v.tx.to)}</a> : "contract creation"}</dd></div>
          </>}
          {v.signer && <div className="bg-panel px-8 py-4"><dt className="text-[12px] text-muted">Signer · type</dt><dd className="mt-1 font-mono">{short(v.signer)} · {v.primaryType}</dd></div>}
          <div className="bg-panel px-8 py-4"><dt className="text-[12px] text-muted">Checked</dt><dd className="mt-1 font-mono">{when} · Robinhood Chain</dd></div>
          <div className="bg-panel px-8 py-4"><dt className="text-[12px] text-muted">Check ID</dt><dd className="mt-1 truncate font-mono">{short(id)}</dd></div>
        </dl>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ShareButtons text={`Heimdall Shield says ${r.verdict}: ${headline(r)}`} />
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
