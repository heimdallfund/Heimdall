"use client";
import { useState } from "react";
import Link from "next/link";
import { decodeEventLog, type Address } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { ADDRESSES } from "@/lib/config";
import { heimdallVaultFactoryAbi } from "@/lib/abi";
import { ConnectButton } from "@/components/ConnectButton";
import { LaunchBanner, AuditNotice } from "@/components/Preview";

const input = "min-h-11 rounded-lg border border-line-strong bg-panel px-3 py-2.5 outline-none focus:border-brand";

export function CreateVault() {
  const { address } = useAccount();
  const pc = usePublicClient();
  const { writeContractAsync, isPending, error } = useWriteContract();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("h");
  const [trade, setTrade] = useState(20);
  const [loss, setLoss] = useState(2);
  const [created, setCreated] = useState<Address | null>(null);
  const valid = name.trim().length >= 3 && /^[A-Za-z0-9]{2,11}$/.test(symbol) && trade > 0 && trade <= 25 && loss >= 0 && loss <= 3;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ADDRESSES.factory || !valid) return;
    const hash = await writeContractAsync({ address: ADDRESSES.factory, abi: heimdallVaultFactoryAbi, functionName: "createVault", args: [name.trim(), symbol, Math.round(trade * 100), Math.round(loss * 100)] });
    const rc = await pc!.waitForTransactionReceipt({ hash });
    for (const l of rc.logs) {
      try {
        const ev = decodeEventLog({ abi: heimdallVaultFactoryAbi, data: l.data, topics: l.topics });
        if (ev.eventName === "VaultCreated") setCreated((ev.args as { vault: Address }).vault);
      } catch { /* other events */ }
    }
  }

  if (created) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-6">
        <h2 className="text-lg font-semibold">Vault created</h2>
        <p className="font-mono text-sm">{created}</p>
        <p className="text-sm text-muted">Next: point your agent at it with the SDK&apos;s <code className="font-mono">executeThroughVault</code>, or run the Heimdall reference agent.</p>
        <Link href={`/vaults/${created}`} className="inline-flex min-h-11 items-center self-start rounded-lg bg-brand px-5 font-semibold text-white">Open the vault page</Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
    <AuditNotice cap="New vaults start capped at 10,000 USDG." />
    {!ADDRESSES.factory && <LaunchBanner>The vault factory goes live with the mainnet launch. You can fill this in now; creating a vault is enabled at launch.</LaunchBanner>}
    <form onSubmit={submit} className="card grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5 text-[13px] font-medium sm:col-span-2">Vault name<input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Guardian Balanced" maxLength={40} /></label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium">Share symbol<input className={`${input} font-mono`} value={symbol} onChange={(e) => setSymbol(e.target.value)} maxLength={11} /></label>
      <div />
      <label className="flex flex-col gap-1.5 text-[13px] font-medium">Max per trade (% of NAV, up to 25)<input className={`${input} font-mono`} type="number" min={1} max={25} step={1} value={trade} onChange={(e) => setTrade(Number(e.target.value))} /></label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium">Max loss per trade (%, up to 3)<input className={`${input} font-mono`} type="number" min={0} max={3} step={0.5} value={loss} onChange={(e) => setLoss(Number(e.target.value))} /></label>
      <p className="text-xs leading-relaxed text-muted sm:col-span-2">New vaults start with a deposit cap of 10,000 USDG while Heimdall is new; the multisig raises it as vaults build a record. Fee: 15% of new profit (10% to you as manager, 5% to Heimdall).</p>
      <div className="sm:col-span-2">
        {!ADDRESSES.factory ? <button type="button" disabled className="btn btn-primary opacity-50">Available at launch</button> : !address ? <ConnectButton /> : <button type="submit" disabled={!valid || isPending} className="btn btn-primary disabled:opacity-50">{isPending ? "Confirm in wallet…" : "Create vault"}</button>}
        {error && <p role="alert" className="mt-3 text-sm text-deny">{error.message.split("\n")[0]}</p>}
      </div>
    </form>
    </div>
  );
}
