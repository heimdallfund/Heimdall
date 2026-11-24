"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CODE_LABEL } from "@/lib/codes";
import type { RadarSnapshot, RadarToken } from "@/lib/radar";

type Filter = "all" | "passed" | "risky";
type Sort = "buyers" | "new";

const VERDICT = {
  ALLOW: "border-allow/50 bg-allow-soft text-allow",
  WARN: "border-warn/50 bg-warn-soft text-warn",
  DENY: "border-deny/50 bg-deny-soft text-deny",
} as const;

const ago = (t: number, now: number) => {
  const m = Math.max(1, Math.round((now - t) / 60_000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
const label = (code: string) => { const l = CODE_LABEL[code] ?? code.replace(/_/g, " ").toLowerCase(); return l.charAt(0).toUpperCase() + l.slice(1); };

function Row({ t, now }: { t: RadarToken; now: number }) {
  const c = t.check;
  const total = t.buys1h + t.sells1h;
  const buyShare = total ? Math.round((t.buys1h / total) * 100) : 0;
  return (
    <Link href={`/token-check/${t.token}`} className="card group flex flex-col gap-3 p-4 transition-colors hover:border-brand sm:flex-row sm:items-center sm:gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[18px] font-semibold group-hover:text-brand">{t.symbol ?? `${t.token.slice(0, 8)}…`}</span>
          {t.name && t.name !== t.symbol && <span className="max-w-[200px] truncate text-[13.5px] text-muted">{t.name}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
          <span className="rounded-sm bg-ink-2 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-ink">{t.venue}</span>
          <span>launched {ago(t.launchedAt, now)} ago</span>
          {c?.progressPct != null && <span>· curve {c.progressPct.toFixed(0)}%</span>}
          {c?.holders != null && <span>· {c.holders.toLocaleString("en-US")} holders</span>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 text-[13px] sm:w-[300px]">
        <div><div className="font-mono text-[17px] font-semibold">{t.buyers1h}</div><div className="text-muted">buyers 1h</div></div>
        <div><div className="font-mono text-[17px] font-semibold">{t.buys1h}<span className="text-muted">/</span>{t.sells1h}</div><div className="text-muted">buys/sells</div></div>
        <div className="flex flex-col justify-center gap-1"><span className="h-1.5 w-full overflow-hidden rounded-full bg-deny-soft"><span className="block h-full bg-allow" style={{ width: `${buyShare}%` }} /></span><span className="text-muted">{buyShare}% buys</span></div>
      </div>
      <div className="flex items-center gap-3 sm:w-[230px] sm:flex-col sm:items-end sm:gap-1">
        {c ? (
          <>
            <span className={`rounded-[3px] border px-2 py-0.5 font-mono text-[13px] font-bold ${VERDICT[c.verdict]}`}>{c.verdict}</span>
            <span className="min-w-0 truncate text-[12.5px] text-muted sm:max-w-[230px] sm:text-right">{c.flags[0] ? label(c.flags[0]) : "Passed every check"}{c.flags.length > 1 ? ` +${c.flags.length - 1}` : ""}</span>
          </>
        ) : <span className="text-[12.5px] text-muted">Not checked yet · tap to check</span>}
      </div>
    </Link>
  );
}

export function RadarList() {
  const [snap, setSnap] = useState<RadarSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("buyers");
  const [now, setNow] = useState<number | null>(null);
  const snapRef = useRef<RadarSnapshot | null>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch("/api/radar", { cache: "no-store" });
        if (r.ok) { const j = await r.json() as RadarSnapshot; if (!stop) { snapRef.current = j; setSnap(j); setError(false); } }
        else if (!stop) setError(true);
      } catch { if (!stop) setError(true); }
      if (!stop) setNow(Date.now());
    };
    // every 10 seconds while the first snapshot is being built, then every minute
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => { await load(); if (!stop) timer = setTimeout(loop, snapRef.current ? 60_000 : 10_000); };
    loop();
    return () => { stop = true; clearTimeout(timer); };
  }, []);

  const rows = useMemo(() => {
    const list = (snap?.tokens ?? []).filter((t) => filter === "all" ? true : filter === "passed" ? t.check?.verdict === "ALLOW" : t.check && t.check.verdict !== "ALLOW");
    return sort === "new" ? [...list].sort((a, b) => b.launchedAt - a.launchedAt) : list;
  }, [snap, filter, sort]);

  const chip = (on: boolean) => `rounded-[3px] border px-3 py-1.5 font-mono text-[12px] uppercase tracking-wider ${on ? "border-ink bg-ink text-paper" : "border-line bg-panel text-muted hover:text-ink"}`;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(filter === "all")} onClick={() => setFilter("all")}>All</button>
          <button type="button" className={chip(filter === "passed")} onClick={() => setFilter("passed")}>Passed checks</button>
          <button type="button" className={chip(filter === "risky")} onClick={() => setFilter("risky")}>Flagged</button>
        </div>
        <div className="flex gap-2">
          <button type="button" className={chip(sort === "buyers")} onClick={() => setSort("buyers")}>Most buyers</button>
          <button type="button" className={chip(sort === "new")} onClick={() => setSort("new")}>Newest</button>
        </div>
      </div>
      {snap && now !== null && (
        <p className="text-[12.5px] text-muted">{snap.launched24h.toLocaleString("en-US")} tokens launched in the last 24 hours · showing the {snap.tokens.length} with the most buyers in the last hour · updated {ago(snap.generatedAt, now)} ago, refreshes every minute</p>
      )}
      {!snap && !error && <div className="card p-6 text-muted">Scanning the last 24 hours of launches…</div>}
      {!snap && error && <div className="card p-6 text-muted">The radar is scanning launches and running the first checks. This page updates by itself in a few seconds.</div>}
      {snap && now !== null && (rows.length ? <div className="flex flex-col gap-2.5">{rows.map((t) => <Row key={t.token} t={t} now={now} />)}</div> : <div className="card p-6 text-muted">Nothing matches this filter right now.</div>)}
      <p className="text-[12.5px] leading-relaxed text-muted">A buyer is a wallet that received the token from its curve or pool in the last hour; buys and sells are counted the same way. A verdict is Token Check on the current chain state, refreshed every 45 minutes or sooner; open a token for the full report. Busy does not mean safe, and passing the checks does not mean the price will hold.</p>
    </section>
  );
}
