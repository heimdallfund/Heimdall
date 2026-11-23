"use client";
import { useEffect, useState } from "react";

/** Shows "API operational" only after a live health check succeeds; renders nothing otherwise. */
export function StatusPill() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    fetch("/api/status", { signal: ctl.signal }).then((r) => r.json()).then((j: { ok: boolean }) => setOk(j.ok)).catch(() => {}).finally(() => clearTimeout(t));
    return () => ctl.abort();
  }, []);
  if (!ok) return null;
  return (
    <a href="/status" className="inline-flex items-center gap-2 self-start border border-paper/25 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-paper hover:border-paper">
      <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-allow opacity-50" /><span className="relative inline-flex size-2 rounded-full bg-allow" /></span>
      API operational
    </a>
  );
}
