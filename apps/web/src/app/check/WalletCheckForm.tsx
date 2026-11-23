"use client";
import { track } from "@/lib/track";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Icon } from "@/components/Icons";

/** Paste any address, or use the connected wallet. */
export function WalletCheckForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { address } = useAccount();
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const go = (a: string) => {
    const v = a.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) { setErr("Paste a wallet address (0x + 40 hex characters)."); return; }
    track("wallet_check");
    router.push(`/check/${v}`);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); go(q); }} className={`flex w-full flex-col gap-3 ${compact ? "" : "max-w-[640px]"}`}>
      <div className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-2 border-ink shadow-[4px_4px_0_var(--color-ink)] sm:flex-row">
        <label htmlFor="wc" className="sr-only">Wallet address</label>
        <input id="wc" value={q} onChange={(e) => { setQ(e.target.value); setErr(null); }} placeholder="0x… any Robinhood Chain wallet" spellCheck={false} autoComplete="off"
          className="min-h-12 min-w-0 flex-1 rounded-xl bg-transparent px-4 font-mono text-[15px] outline-none placeholder:text-muted/70" />
        <button type="submit" className="btn btn-primary min-h-12 px-6">Check wallet</button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[14px] text-muted">
        {address ? (
          <button type="button" onClick={() => go(address)} className="inline-flex items-center gap-1.5 font-semibold text-brand hover:underline"><Icon name="shield" size={16} />Check my connected wallet</button>
        ) : <span>Read-only: nothing is signed to check a wallet.</span>}
      </div>
      {err && <p role="alert" className="text-[14px] text-deny">{err}</p>}
    </form>
  );
}
