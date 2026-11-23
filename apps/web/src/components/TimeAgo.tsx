"use client";
import { useEffect, useState } from "react";

/** Relative time computed in the browser (server renders a UTC timestamp). */
export function TimeAgo({ t }: { t: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const i = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(i); }, []);
  if (now === null) return <>{new Date(t).toISOString().slice(11, 16)} UTC</>;
  const s = Math.max(1, Math.round((now - t) / 1000));
  return <>{s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86_400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86_400)}d ago`}</>;
}
