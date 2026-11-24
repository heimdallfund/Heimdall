"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CODE_LABEL } from "@/lib/codes";
import { RUG_WORD, span, utc, type RugEvent, type RugLog } from "@/lib/rugs";

const VERDICT = {
  ALLOW: "border-allow/50 bg-allow-soft text-allow",
  WARN: "border-warn/50 bg-warn-soft text-warn",
  DENY: "border-deny/50 bg-deny-soft text-deny",
} as const;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
const label = (code: string) => { const l = CODE_LABEL[code] ?? code.replace(/_/g, " ").toLowerCase(); return l.charAt(0).toUpperCase() + l.slice(1); };

function Rug({ e }: { e: RugEvent }) {
  const missed = e.before.verdict === "ALLOW";
  return (
    <article className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link href={`/token-check/${e.token}`} className="text-[20px] font-semibold hover:text-brand">{e.symbol ?? `${e.token.slice(0, 8)}…`}</Link>
            {e.name && e.name !== e.symbol && <span className="max-w-[240px] truncate text-[14px] text-muted">{e.name}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
            {e.venue && <span className="rounded-sm bg-ink-2 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-ink">{e.venue}</span>}
            <span>detected {utc(e.detectedAt)}</span>
          </div>
        </div>
        <span className="rounded-[3px] border border-deny bg-deny px-2 py-0.5 font-mono text-[12.5px] font-bold uppercase tracking-wider text-paper">{RUG_WORD[e.kind]}</span>
      </div>
      <div className="flex flex-col gap-2 rounded-[3px] border border-line bg-paper p-3.5">
        <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
          <span className="text-muted">First check, {span(e.detectedAt - e.before.at)} earlier:</span>
          <span className={`rounded-[3px] border px-2 py-0.5 font-mono text-[12.5px] font-bold ${VERDICT[e.before.verdict]}`}>{e.before.verdict}</span>
          <span className="font-mono text-[12.5px] text-muted">risk {e.before.riskScore}/100</span>
        </div>
        {e.before.flags.length ? (
          <div className="flex flex-wrap gap-1.5">{e.before.flags.slice(0, 5).map((f) => <span key={f} className={`rounded-[3px] border px-1.5 py-0.5 text-[12px] ${f === "LP_REMOVABLE" ? "border-deny/50 font-semibold text-deny" : "border-line text-ink"}`}>{label(f)}</span>)}</div>
        ) : <span className="text-[13px] text-muted">It passed every check at the time.</span>}
        {missed && <span className="text-[12.5px] font-semibold text-warn">Missed: Heimdall passed this token.</span>}
      </div>
      {e.evidence && <p className="text-[13.5px] leading-relaxed text-muted">{e.evidence}</p>}
    </article>
  );
}

export function RugLogView() {
  const [log, setLog] = useState<RugLog | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stop = false;
    const load = () => fetch("/api/rugs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject())).then((j: RugLog) => { if (!stop) { setLog(j); setError(false); } }).catch(() => { if (!stop) setError(true); });
    load();
    const t = setInterval(load, 60_000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  if (!log) return <div className="card p-6 text-muted">{error ? "The rug log could not be loaded. Try again in a minute." : "Loading the record…"}</div>;
  return (
    <section className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card flex flex-col gap-1 p-4 sm:p-5"><span className="label">Rugs recorded</span><span className="font-mono text-[34px] font-bold">{log.total}</span><span className="text-[13px] text-muted">{log.watching.toLocaleString("en-US")} tokens on watch now</span></div>
        <div className="card flex flex-col gap-1 p-4 sm:p-5"><span className="label">Flagged beforehand</span><span className="font-mono text-[34px] font-bold text-allow">{pct(log.flagged, log.total)}</span><span className="text-[13px] text-muted">{log.flagged} were WARN or DENY at their first check</span></div>
        <div className="card flex flex-col gap-1 p-4 sm:p-5"><span className="label">Pull warned</span><span className="font-mono text-[34px] font-bold">{pct(log.lpWarned, log.total)}</span><span className="text-[13px] text-muted">{log.lpWarned} had “liquidity can be pulled” at their first check</span></div>
        <div className="card flex flex-col gap-1 p-4 sm:p-5"><span className="label">Missed</span><span className="font-mono text-[34px] font-bold text-warn">{log.passed}</span><span className="text-[13px] text-muted">rugged after Heimdall passed them (ALLOW)</span></div>
      </div>
      {log.events.length ? (
        <div className="grid gap-3 md:grid-cols-2">{log.events.map((e) => <Rug key={e.token} e={e} />)}</div>
      ) : (
        <div className="card flex flex-col gap-2 p-6">
          <span className="font-semibold">Nothing has rugged on watch yet</span>
          <span className="text-muted">The record started on 2026-11-24. {log.watching.toLocaleString("en-US")} tokens are being re-checked right now; the risky ones every 10 minutes, the rest every 45.</span>
        </div>
      )}
      <p className="text-[12.5px] leading-relaxed text-muted">How this works: the first Token Check of a token, from the <Link href="/radar" className="underline hover:text-brand">Launch Radar</Link> or from anyone checking it, is stored with its verdict and findings. Tokens that still traded then are re-checked for three days: every 10 minutes when the first check found a risk such as liquidity that can be pulled or owner powers, otherwise every 45 minutes. A token is listed when a re-check shows its pool liquidity was removed or that it can no longer be sold. Tokens that were already dead at their first check are never listed. The time shown is from the first check to when the re-check caught it, so the rug happened somewhere in between. Accuracy over all checked tokens, not only rugs, is on the <Link href="/security#accuracy" className="underline hover:text-brand">Security page</Link>.</p>
    </section>
  );
}
