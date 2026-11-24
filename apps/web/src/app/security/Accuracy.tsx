"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Outcome = "rugged" | "honeypot" | "dumped" | "fine";
interface Card {
  since: number | null; pending: number; evaluated: number; bad: number; caught: number; passed: number; passedBad: number; denied: number; deniedBad: number;
  byOutcome: Record<Outcome, number>; recent: { token: string; symbol: string | null; verdict: "ALLOW" | "WARN" | "DENY"; outcome: Outcome; at: number }[];
}
const MIN = 20;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
const WORD: Record<Outcome, string> = { rugged: "liquidity pulled", honeypot: "selling stopped", dumped: "dev sold out", fine: "fine" };

/** Radar verdicts scored against what happened to the same tokens a day later. */
export function Accuracy() {
  const [c, setC] = useState<Card | null>(null);
  useEffect(() => { fetch("/api/bench").then((r) => (r.ok ? r.json() : null)).then(setC).catch(() => {}); }, []);
  return (
    <section id="accuracy" aria-labelledby="accuracy-h" className="flex scroll-mt-24 flex-col gap-5">
      <div><span className="eyebrow">Measured, not claimed</span><h2 id="accuracy-h" className="display mt-2 text-[41px]">Token Check accuracy</h2></div>
      <p className="max-w-[760px] leading-relaxed text-muted">Every token the Launch Radar checks has its first verdict recorded. A day later the same token is checked again and what actually happened is read from the chain: its liquidity was pulled, selling stopped working, or the dev sold out. The numbers below compare the two. Nothing is back-filled or adjusted afterwards. Every rug caught along the way, with the verdict from before, is in the <Link href="/rugs" className="underline hover:text-brand">Hall of Rugs</Link>.</p>
      {!c ? <div className="card p-6 text-muted">Loading the scorecard…</div> : c.evaluated < MIN ? (
        <div className="card flex flex-col gap-2 p-6">
          <span className="font-semibold">Collecting</span>
          <span className="text-muted">{c.pending + c.evaluated} verdicts recorded, {c.evaluated} judged so far. The scorecard appears once {MIN} tokens have been judged, a day after their first check.</span>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card flex flex-col gap-1 p-5"><span className="label">Bad tokens flagged beforehand</span><span className="font-mono text-[34px] font-bold text-allow">{pct(c.caught, c.bad)}</span><span className="text-[13px] text-muted">{c.caught} of {c.bad} tokens that went bad were WARN or DENY at their first check</span></div>
            <div className="card flex flex-col gap-1 p-5"><span className="label">Passed, then went bad</span><span className="font-mono text-[34px] font-bold text-warn">{pct(c.passedBad, c.passed)}</span><span className="text-[13px] text-muted">{c.passedBad} of {c.passed} tokens Heimdall passed (ALLOW) went bad within a day</span></div>
            <div className="card flex flex-col gap-1 p-5"><span className="label">DENY that went bad</span><span className="font-mono text-[34px] font-bold">{pct(c.deniedBad, c.denied)}</span><span className="text-[13px] text-muted">{c.deniedBad} of {c.denied} denied tokens were pulled, stuck or dumped a day later</span></div>
          </div>
          <p className="text-[13px] text-muted">{c.evaluated} tokens judged{c.since ? ` since ${new Date(c.since).toISOString().slice(0, 10)}` : ""}: {c.byOutcome.rugged} liquidity pulled, {c.byOutcome.honeypot} selling stopped, {c.byOutcome.dumped} dev sold out, {c.byOutcome.fine} fine. A DENY that stayed fine for a day is not a mistake by itself: a token can carry a trap that has not been sprung yet.</p>
        </>
      )}
      {c && c.recent.length > 0 && (
        <div className="card flex flex-col gap-2 p-5">
          <span className="label">Recent tokens that went bad</span>
          <ul className="flex flex-col gap-1.5 text-[14px]">
            {c.recent.map((r) => (
              <li key={r.token} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-1.5">
                <Link href={`/token-check/${r.token}`} className="font-semibold hover:text-brand">{r.symbol ?? `${r.token.slice(0, 8)}…`}</Link>
                <span className="text-muted">{WORD[r.outcome]} · first check said <span className={r.verdict === "ALLOW" ? "font-semibold text-warn" : "font-semibold text-allow"}>{r.verdict}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
