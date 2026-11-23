"use client";
import Link from "next/link";
import { useState } from "react";
// viem and the chain config load on first use, so they stay out of the homepage's initial JavaScript.
const isAddr = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);
const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN === "testnet" ? 46630 : 4663;
import { VerdictBadge } from "../Verdict";
import { Icon } from "../Icons";

type Result = { verdict: "ALLOW" | "WARN" | "DENY"; riskScore: number; summary: string[]; findings: { code: string; severity: string; message: string }[]; shareId?: string };
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

/** A per-visitor throwaway sender so free quotas apply per visitor (it never signs anything). */
function visitorWallet(): `0x${string}` {
  try {
    const k = "heimdall.visitor";
    const v = localStorage.getItem(k);
    if (v && isAddr(v)) return v as `0x${string}`;
    const b = crypto.getRandomValues(new Uint8Array(20));
    const a = `0x${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
    localStorage.setItem(k, a);
    return a;
  } catch {
    return "0x5eeD5EED5eeD5EEd5eed5eEd5eEd5eed5EeD5EEd";
  }
}

/** Paste a transaction hash or an address and get a Shield verdict right on the homepage. */
export function HeroCheck() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ r: Result; mode: "tx" | "address" } | null>(null);

  async function run(input = q) {
    const v = input.trim();
    setErr(null); setRes(null);
    let body: Record<string, unknown>;
    let mode: "tx" | "address";
    if (/^0x[0-9a-fA-F]{64}$/.test(v)) {
      mode = "tx";
      setBusy(true);
      try {
        const [{ createPublicClient, http }, { chain }] = await Promise.all([import("viem"), import("@/lib/config")]);
        const tx = await createPublicClient({ chain, transport: http() }).getTransaction({ hash: v as `0x${string}` });
        body = { chainId: CHAIN_ID, from: tx.from, to: tx.to, data: tx.input, value: tx.value.toString(), share: true };
      } catch {
        setBusy(false); setErr("Transaction not found on Robinhood Chain."); return;
      }
    } else if (isAddr(v)) {
      mode = "address";
      const { encodeFunctionData, maxUint256, parseAbi } = await import("viem");
      body = { chainId: CHAIN_ID, from: visitorWallet(), to: USDG, value: "0", share: true, probe: true,
        data: encodeFunctionData({ abi: parseAbi(["function approve(address,uint256)"]), functionName: "approve", args: [v as `0x${string}`, maxUint256] }) };
    } else {
      setErr("Paste a transaction hash (0x + 64 hex) or an address."); return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) setErr(r.status === 503 ? "Shield goes live with the mainnet launch. Try the example below in a moment." : j.message ?? "Check failed.");
      else setRes({ r: j as Result, mode });
    } catch {
      setErr("Shield could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  const url = res?.r.shareId ? `/v/${res.r.shareId}` : null;
  return (
    <div className="w-full max-w-[640px]">
      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="flex items-center gap-2 border border-ink bg-panel p-1.5 focus-within:shadow-[4px_4px_0_var(--color-brand)]">
        <Icon name="shield" size={18} className="ml-2.5 shrink-0 text-brand" />
        <input value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} aria-label="Transaction hash or address"
          placeholder="Paste a tx hash or an address to check" className="min-h-11 min-w-0 flex-1 bg-transparent font-mono text-[14px] outline-none placeholder:font-sans placeholder:text-muted" />
        <button type="submit" disabled={busy} className="btn btn-primary min-h-11 shrink-0 px-4 disabled:opacity-60">{busy ? "Checking…" : "Check"}</button>
      </form>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted">
        <span>Try</span>
        <button type="button" onClick={() => { const a = "0x3333333333333333333333333333333333333333"; setQ(a); run(a); }} className="border border-line bg-panel px-2 py-0.5 hover:border-ink hover:text-ink">approving a random wallet</button>
        <button type="button" onClick={() => { const a = "0xcaf681a66d020601342297493863e78c959e5cb2"; setQ(a); run(a); }} className="border border-line bg-panel px-2 py-0.5 hover:border-ink hover:text-ink">approving Uniswap</button>
      </div>
      {err && <p role="alert" className="mt-4 border border-line bg-ice px-4 py-3 text-[14px] text-muted">{err}</p>}
      {res && (
        <div className="page-in card mt-4 p-5 text-left">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-muted">{res.mode === "address" ? "Approving this address" : "This transaction, on the latest block"}</div>
              <div className="mt-1 text-[15px] font-semibold">{res.r.findings.find((f) => f.severity === "deny")?.message ?? res.r.findings.find((f) => f.severity === "warn")?.message ?? res.r.summary[0] ?? "Checked"}</div>
            </div>
            <VerdictBadge kind={res.r.verdict} size="lg" />
          </div>
          {res.r.findings.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5">{res.r.findings.filter((f) => f.severity !== "info").slice(0, 3).map((f) => <li key={f.code} className="flex gap-2 text-[14px]"><span className={`mt-[7px] size-2 shrink-0 rounded-full ${f.severity === "deny" ? "bg-deny" : f.severity === "warn" ? "bg-[#D99A00]" : "bg-[#9AA3B5]"}`} />{f.message}</li>)}</ul>
          )}
          {url && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              <Link href={url} className="btn btn-secondary min-h-10 px-3.5">Full result <Icon name="arrow" size={15} /></Link>
              <a href={`https://x.com/intent/post?text=${encodeURIComponent(`Heimdall Shield says ${res.r.verdict}: ${res.r.summary[0] ?? ""}`)}&url=${encodeURIComponent(`${location.origin}${url}`)}`} target="_blank" rel="noreferrer" className="btn btn-secondary min-h-10 px-3.5">Share on X</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
