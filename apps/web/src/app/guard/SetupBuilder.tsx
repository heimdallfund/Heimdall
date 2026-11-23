"use client";
import { useMemo, useState } from "react";
import { encodeFunctionData, isAddress, parseAbi, parseEther, parseUnits, type Address, type Hex } from "viem";
import { heimdallGuardModuleAbi } from "@/lib/abi";
import { ADDRESSES } from "@/lib/config";

const SAFE = parseAbi(["function enableModule(address module)"]);

export function SetupBuilder({ module }: { module?: Address }) {
  const [safe, setSafe] = useState("");
  const [agent, setAgent] = useState("");
  const [usdg, setUsdg] = useState("100");
  const [eth, setEth] = useState("0");
  const [days, setDays] = useState("30");
  const [strict, setStrict] = useState(true);
  const ready = !!module && isAddress(safe) && isAddress(agent);

  const calls = useMemo(() => {
    if (!ready || !module) return [];
    const call = (data: Hex, to: Address = module) => ({ to, value: "0", data });
    const exp = Number(days) > 0 ? BigInt(Math.floor(Date.now() / 1000) + Math.round(Number(days) * 86_400)) : 0n;
    const usdgPerDay = (() => { try { return parseUnits(usdg || "0", 6); } catch { return 0n; } })();
    const ethPerDay = (() => { try { return parseEther(eth || "0"); } catch { return 0n; } })();
    return [
      call(encodeFunctionData({ abi: SAFE, functionName: "enableModule", args: [module] }), safe as Address),
      call(encodeFunctionData({ abi: heimdallGuardModuleAbi, functionName: "setPolicy", args: [ethPerDay, strict, false] })),
      call(encodeFunctionData({ abi: heimdallGuardModuleAbi, functionName: "setTokenLimit", args: [ADDRESSES.usdg, usdgPerDay, true] })),
      call(encodeFunctionData({ abi: heimdallGuardModuleAbi, functionName: "setAgent", args: [agent as Address, true, exp] })),
    ];
  }, [ready, module, safe, agent, usdg, eth, days, strict]);

  function download() {
    const batch = { version: "1.0", chainId: "4663", createdAt: Date.now(), meta: { name: "Heimdall Guard setup", description: `Enable Heimdall Guard on ${safe}; agent ${agent} may spend ${usdg} USDG and ${eth} ETH per 24 h` }, transactions: calls };
    const url = URL.createObjectURL(new Blob([JSON.stringify(batch, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = "heimdall-guard-setup.json"; a.click();
    URL.revokeObjectURL(url);
  }

  const field = "min-h-11 w-full border border-ink bg-panel px-3 font-mono text-[14px] outline-none focus:shadow-[3px_3px_0_var(--color-brand)]";
  return (
    <div className="grid gap-6 border border-ink bg-panel p-6 shadow-[6px_6px_0_var(--color-ink)] lg:grid-cols-[1.2fr_1fr]">
      <div className="flex flex-col gap-4">
        <span className="label text-ink">Build your setup</span>
        <label className="flex flex-col gap-1.5 text-[14px] font-semibold">Your Safe on Robinhood Chain<input className={field} value={safe} onChange={(e) => setSafe(e.target.value.trim())} placeholder="0x…" spellCheck={false} /></label>
        <label className="flex flex-col gap-1.5 text-[14px] font-semibold">Agent wallet (signs, never owns)<input className={field} value={agent} onChange={(e) => setAgent(e.target.value.trim())} placeholder="0x…" spellCheck={false} /></label>
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold">USDG / day<input className={field} inputMode="decimal" value={usdg} onChange={(e) => setUsdg(e.target.value)} /></label>
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold">ETH / day<input className={field} inputMode="decimal" value={eth} onChange={(e) => setEth(e.target.value)} /></label>
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold">Expires (days)<input className={field} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
        </div>
        <label className="flex items-start gap-2 text-[14px]"><input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} className="mt-1 size-4 accent-[var(--color-brand)]" /><span><b>Strict tokens.</b> The agent can only move tokens you limited (USDG here). Recommended.</span></label>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <span className="label text-ink">Safe transactions ({calls.length || 4})</span>
        <ol className="flex flex-col gap-2 font-mono text-[12.5px]">
          {["enableModule(Heimdall Guard)", `setPolicy(${eth || 0} ETH/day, strict ${strict})`, `setTokenLimit(USDG, ${usdg || 0}/day)`, `setAgent(agent, expires in ${days || "∞"} days)`].map((t, i) => (
            <li key={t} className="flex gap-2 border border-line bg-paper px-3 py-2"><span className="text-brand">{i + 1}</span><span className="break-all">{t}</span></li>
          ))}
        </ol>
        <button type="button" disabled={!ready} onClick={download} className="btn btn-primary mt-1 disabled:opacity-50">Download for Transaction Builder</button>
        <p className="text-[12.5px] text-muted">{module ? "Import the file in app.safe.global → Apps → Transaction Builder, check it, then sign with your owners." : "The module address is published at the mainnet launch; the file can be built then."}</p>
      </div>
    </div>
  );
}
