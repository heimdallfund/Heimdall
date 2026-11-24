"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { track } from "@/lib/track";

/** Paste a token contract address; the report page runs the simulation. */
export function TokenCheckForm({ compact = false, initial = "" }: { compact?: boolean; initial?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const go = () => {
    const v = q.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) { setErr("Paste a token contract address (0x + 40 hex characters)."); return; }
    track("token_check");
    router.push(`/token-check/${v}`);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); go(); }} className={`flex w-full flex-col gap-3 ${compact ? "" : "max-w-[640px]"}`}>
      <div className="flex flex-col gap-2 rounded-2xl border border-ink bg-white p-2 shadow-[4px_4px_0_var(--color-ink)] sm:flex-row">
        <label htmlFor="tc" className="sr-only">Token contract address</label>
        <input id="tc" value={q} onChange={(e) => { setQ(e.target.value); setErr(null); }} placeholder="0x… token contract on Robinhood Chain" spellCheck={false} autoComplete="off"
          className="min-h-12 min-w-0 flex-1 rounded-xl bg-transparent px-4 font-mono text-[15px] outline-none placeholder:text-muted/70" />
        <button type="submit" className="btn btn-primary min-h-12 px-6">Check token</button>
      </div>
      {!compact && <p className="text-[14px] text-muted">Copy the address from the project's own site or the explorer, never from a DM. Nothing is signed or bought.</p>}
      {err && <p role="alert" className="text-[14px] text-deny">{err}</p>}
    </form>
  );
}
