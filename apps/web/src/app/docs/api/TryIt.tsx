"use client";
import { useState } from "react";
import { PUBLIC_API_URL } from "@/lib/config";

/** Sends one real request to the Shield API from the browser and shows the answer. */
export function TryIt({ method, path, body }: { method: "GET" | "POST"; path: string; body?: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(path);
  const [text, setText] = useState(body ?? "");
  const [res, setRes] = useState<{ status: number; ms: number; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true); setRes(null);
    const t = performance.now();
    try {
      const r = await fetch(`${PUBLIC_API_URL}${url}`, method === "POST" ? { method, headers: { "content-type": "application/json" }, body: text } : undefined);
      const raw = await r.text();
      let pretty = raw; try { pretty = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* not JSON */ }
      setRes({ status: r.status, ms: Math.round(performance.now() - t), body: pretty.slice(0, 20_000) });
    } catch (e) {
      setRes({ status: 0, ms: Math.round(performance.now() - t), body: `Could not reach ${PUBLIC_API_URL}: ${(e as Error).message}` });
    } finally { setBusy(false); }
  };

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="self-start rounded-md border border-line-strong px-3 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-wider hover:border-ink">Try it</button>;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line-strong bg-panel p-3">
      <label className="flex items-center gap-2 font-mono text-[12.5px]"><span className="font-semibold">{method}</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Path" className="min-w-0 flex-1 rounded border border-line bg-paper px-2 py-1.5 outline-none focus:border-brand" />
      </label>
      {method === "POST" && <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Request body" rows={6} spellCheck={false} className="w-full rounded border border-line bg-paper p-2 font-mono text-[12px] outline-none focus:border-brand" />}
      <div className="flex items-center gap-3">
        <button type="button" onClick={send} disabled={busy} className="btn btn-primary min-h-9 px-4 text-[13px]">{busy ? "Sending…" : "Send"}</button>
        {res && <span className={`font-mono text-[12.5px] ${res.status >= 200 && res.status < 300 ? "text-allow" : "text-deny"}`}>{res.status || "network error"} · {res.ms} ms</span>}
      </div>
      {res && <pre className="max-h-80 overflow-auto rounded bg-ink p-3 font-mono text-[12px] leading-relaxed text-paper">{res.body}</pre>}
    </div>
  );
}
