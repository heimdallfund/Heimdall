"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PUBLIC_API_URL } from "@/lib/config";

type Recent = { at: number; kind: "tx" | "sig"; target: string | null; codes: string[]; summary: string };
const utc = (t: number) => new Date(t).toISOString().slice(11, 16);
const fmt = (n: number) => n.toLocaleString("en-US");

/** A small live strip in the corner: Shield's running totals, and a log of the latest blocked transactions. */
export function LiveBar() {
  const path = usePathname();
  const [stats, setStats] = useState<{ checks: number; denied: number } | null>(null);
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try { if (sessionStorage.getItem("heimdall-livebar") === "off") setHidden(true); } catch {}
    const ctl = new AbortController();
    const load = () => fetch(`${PUBLIC_API_URL}/v1/stats`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : null)).then((s) => s && setStats(s)).catch(() => {});
    const t = setTimeout(load, 1200);
    const i = setInterval(load, 30_000);
    return () => { ctl.abort(); clearTimeout(t); clearInterval(i); };
  }, []);
  useEffect(() => {
    if (!open || recent) return;
    fetch(`${PUBLIC_API_URL}/v1/threats`).then((r) => r.json()).then((j: { recent?: Recent[] }) => setRecent(j.recent ?? [])).catch(() => setRecent([]));
  }, [open, recent]);
  useEffect(() => { setOpen(false); }, [path]);

  if (!stats || hidden || path.startsWith("/admin") || path.startsWith("/docs")) return null;
  return (
    <div className="pointer-events-none fixed bottom-3 left-3 right-3 z-40 flex flex-col items-start gap-2 sm:bottom-4 sm:left-4 sm:right-auto">
      {open && (
        <div id="live-log" role="dialog" aria-label="Latest blocked transactions" className="pointer-events-auto w-full max-w-[420px] border border-ink bg-panel shadow-[4px_4px_0_var(--color-ink)]">
          <div className="flex items-center justify-between border-b border-ink px-3 py-2"><span className="label text-ink">Shield · last blocks</span><Link href="/threats" className="label text-brand hover:underline">Threat Board →</Link></div>
          <ol className="max-h-[300px] divide-y divide-line overflow-y-auto font-mono text-[12px]">
            {recent === null && <li className="px-3 py-3 text-muted">Loading…</li>}
            {recent?.length === 0 && <li className="px-3 py-3 text-muted">Nothing blocked yet.</li>}
            {recent?.slice(0, 12).map((r) => (
              <li key={r.at} className="flex gap-3 px-3 py-2">
                <span className="text-muted">{utc(r.at)}</span>
                <span className="tag shrink-0 bg-deny-soft py-0 text-deny">DENY</span>
                <span className="min-w-0 flex-1 truncate" title={r.summary}>{r.codes[0]?.replaceAll("_", " ").toLowerCase() ?? r.summary}{r.target ? ` · ${r.target.slice(0, 6)}…${r.target.slice(-4)}` : ""}</span>
              </li>
            ))}
          </ol>
          <p className="border-t border-line px-3 py-1.5 font-mono text-[10.5px] text-muted">Times in UTC</p>
        </div>
      )}
      <div className="pointer-events-auto flex items-stretch border border-ink bg-panel font-mono text-[11px] font-semibold uppercase tracking-[0.08em] shadow-[3px_3px_0_var(--color-ink)]">
        <span className="flex items-center gap-2 px-3 py-2"><span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-allow opacity-60 motion-reduce:hidden" /><span className="relative inline-flex size-2 rounded-full bg-allow" /></span>Shield live</span>
        <span className="hidden items-center border-l border-line px-3 sm:flex">{fmt(stats.checks)} checks</span>
        <span className="flex items-center border-l border-line px-3 text-deny">{fmt(stats.denied)} blocked</span>
        <button type="button" aria-expanded={open} aria-controls="live-log" onClick={() => setOpen((v) => !v)} className="border-l border-ink bg-ink px-3 text-paper hover:bg-brand">{open ? "Close" : "Log"}</button>
        <button type="button" aria-label="Hide the live bar" onClick={() => { setHidden(true); try { sessionStorage.setItem("heimdall-livebar", "off"); } catch {} }} className="border-l border-ink px-2.5 text-muted hover:text-ink">×</button>
      </div>
    </div>
  );
}
