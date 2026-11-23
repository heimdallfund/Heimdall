"use client";
import { useState } from "react";
import { decodeEventLog, isAddress, parseUnits, type Address } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { ADDRESSES } from "@/lib/config";
import { heimdallSignalsAbi } from "@/lib/abi";
import { ConnectButton } from "@/components/ConnectButton";
import { LaunchBanner } from "@/components/Preview";

const input = "min-h-11 rounded-lg border border-line-strong bg-panel px-3 py-2.5 outline-none focus:border-brand";
const CATEGORIES = ["stocks", "crypto", "onchain", "sentiment", "risk"];

export function ListSignal() {
  const { address } = useAccount();
  const pc = usePublicClient();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const [f, setF] = useState({ name: "", category: "stocks", description: "", endpoint: "https://", price: "0.02", payout: "" });
  const [id, setId] = useState<string | null>(null);
  let price: bigint | null = null;
  try { price = parseUnits(f.price, 6); } catch { price = null; }
  const payout = (f.payout || address || "") as Address;
  const valid = f.name.trim().length >= 3 && /^https:\/\/.+/.test(f.endpoint) && !!price && price > 0n && isAddress(payout);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ADDRESSES.signals || !valid || !price) return;
    const uri = JSON.stringify({ name: f.name.trim(), category: f.category, description: f.description.trim(), endpoint: f.endpoint.trim() });
    const hash = await writeContractAsync({ address: ADDRESSES.signals, abi: heimdallSignalsAbi, functionName: "register", args: [uri, price, payout] });
    const rc = await pc!.waitForTransactionReceipt({ hash });
    for (const l of rc.logs) {
      try {
        const ev = decodeEventLog({ abi: heimdallSignalsAbi, data: l.data, topics: l.topics });
        if (ev.eventName === "SignalRegistered") setId(String((ev.args as { id: bigint }).id));
      } catch { /* other events */ }
    }
  }

  if (id !== null) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-6">
        <h2 className="text-lg font-semibold">Signal #{id} is live</h2>
        <p className="text-sm text-muted">Use signal ID <span className="font-mono text-ink">{id}</span> and price <span className="font-mono text-ink">{price?.toString()}</span> in <code className="font-mono">gateVoucher</code> on your server.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
    {!ADDRESSES.signals && <LaunchBanner>The signals contract goes live with the mainnet launch. You can fill this in now; listing is enabled at launch.</LaunchBanner>}
    <form onSubmit={submit} className="card grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5 text-[13px] font-medium sm:col-span-2">Name<input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Earnings week drift" maxLength={60} /></label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium">Category<select className={input} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium">Price per call (USDG)<input className={`${input} font-mono`} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} inputMode="decimal" /></label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium sm:col-span-2">What agents get<textarea rows={3} className={`${input} resize-y`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={280} /></label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium sm:col-span-2">Endpoint (HTTPS)<input className={`${input} font-mono text-[13px]`} value={f.endpoint} onChange={(e) => setF({ ...f, endpoint: e.target.value })} /></label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium sm:col-span-2">Payout address (default: your wallet)<input className={`${input} font-mono text-[13px]`} value={f.payout} onChange={(e) => setF({ ...f, payout: e.target.value })} placeholder={address ?? "0x…"} /></label>
      <div className="sm:col-span-2">
        {!ADDRESSES.signals ? <button type="button" disabled className="btn btn-primary opacity-50">Available at launch</button> : !address ? <ConnectButton /> : <button type="submit" disabled={!valid || isPending} className="btn btn-primary disabled:opacity-50">{isPending ? "Confirm in wallet…" : "List signal"}</button>}
        {error && <p role="alert" className="mt-3 text-sm text-deny">{error.message.split("\n")[0]}</p>}
      </div>
    </form>
    </div>
  );
}
