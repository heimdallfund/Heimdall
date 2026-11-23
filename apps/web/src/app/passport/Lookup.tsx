"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress } from "viem";

export function PassportLookup() {
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  async function go(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (isAddress(v)) return router.push(`/agent/${v}`);
    if (/^\d{1,30}$/.test(v)) {
      const r = await fetch(`/api/passport/${v}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (r?.address) return router.push(`/agent/${r.address}?agentId=${v}`);
      return setErr("No agent with that id in the ERC-8004 registry.");
    }
    setErr("Paste a 0x wallet or an ERC-8004 agent id.");
  }
  return (
    <form onSubmit={go} className="flex flex-col gap-2">
      <div className="flex items-center gap-2 border border-ink bg-panel p-1.5 focus-within:shadow-[4px_4px_0_var(--color-brand)]">
        <input value={q} onChange={(e) => { setQ(e.target.value); setErr(null); }} aria-label="Agent wallet or id" placeholder="0x… agent wallet, or agent id" spellCheck={false}
          className="min-h-11 min-w-0 flex-1 bg-transparent px-2 font-mono text-[14px] outline-none placeholder:font-sans placeholder:text-muted" />
        <button type="submit" className="btn btn-primary min-h-11 shrink-0 px-4">Look up</button>
      </div>
      {err && <p className="text-[14px] text-deny">{err}</p>}
    </form>
  );
}
