"use client";
import { useState } from "react";
import { isAddress } from "viem";

interface Risk { address: string; level: number; levelName: string; flagNames: string[]; label: string | null; blocked: boolean; onchain: { level: number; updatedAt: string | null } | null; error?: string; message?: string }

const TONE: Record<string, string> = { none: "border-ink bg-panel text-ink", low: "border-ink bg-panel text-ink", warn: "border-warn bg-warn-soft text-warn", blocked: "border-deny bg-deny-soft text-deny" };

export function RiskLookup() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Risk | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!isAddress(q.trim())) { setErr("Paste a 0x address."); return; }
    setBusy(true); setErr(null); setR(null);
    try {
      const res = await fetch(`/api/risk/${q.trim()}`);
      const j = (await res.json()) as Risk;
      if (!res.ok) setErr(j.message ?? "The risk service is not reachable right now.");
      else setR(j);
    } catch { setErr("The risk service is not reachable right now."); }
    setBusy(false);
  }
  return (
    <div className="border border-ink bg-panel p-5 shadow-[6px_6px_0_var(--color-ink)]">
      <span className="label text-ink">Look up any address</span>
      <form onSubmit={run} className="mt-3 flex items-center gap-2 border border-ink bg-panel p-1.5 focus-within:shadow-[4px_4px_0_var(--color-brand)]">
        <input value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} aria-label="Address" placeholder="0x… token, contract or wallet"
          className="min-h-11 min-w-0 flex-1 bg-transparent px-2 font-mono text-[14px] outline-none placeholder:font-sans placeholder:text-muted" />
        <button type="submit" disabled={busy} className="btn btn-primary min-h-11 shrink-0 px-4 disabled:opacity-60">{busy ? "Checking…" : "Check"}</button>
      </form>
      {err && <p className="mt-3 text-[14px] text-deny">{err}</p>}
      {r && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`tag border-2 ${TONE[r.levelName] ?? TONE.none}`}>Level {r.level} · {r.levelName}</span>
            {r.flagNames.map((f) => <span key={f} className="tag border border-line bg-paper text-ink">{f.replace(/_/g, " ")}</span>)}
          </div>
          <p className="text-[15px]">{r.blocked ? "Blocked: do not send to, approve or sign for this address." : r.level === 2 ? "Warning: Shield has been denying transactions to this address." : r.level === 0 ? "Not on Heimdall's lists. That is not a guarantee: check the transaction itself with Shield." : "Seen in a risky pattern."}{r.label ? ` ${r.label}.` : ""}</p>
          <p className="font-mono text-[12px] text-muted">Onchain oracle: {r.onchain ? `level ${r.onchain.level}${r.onchain.updatedAt ? ` · updated ${r.onchain.updatedAt.slice(0, 16).replace("T", " ")} UTC` : ""}` : "goes live with the mainnet launch"}</p>
        </div>
      )}
    </div>
  );
}
