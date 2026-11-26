"use client";
import { track, type TrackEvent } from "@/lib/track";
import { chain } from "@/lib/config";
import { useChainWrite } from "@/lib/chainWrite";
import { useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { useAccount, useReadContracts, usePublicClient } from "wagmi";
import { heimdallStakingAbi } from "@/lib/abi";
import { ConnectButton } from "@/components/ConnectButton";

const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;
const f = (v: bigint | undefined, d: number, max = 2) => (v === undefined ? "—" : Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: max }));

export function StakePanel({ staking, heim }: { staking: Address; heim: Address }) {
  const { address } = useAccount();
  const pc = usePublicClient({ chainId: chain.id });
  const { writeContractAsync } = useChainWrite();
  const [tab, setTab] = useState<"stake" | "withdraw">("stake");
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const me = address ?? "0x0000000000000000000000000000000000000000";
  const { data, refetch } = useReadContracts({ contracts: [
    { chainId: chain.id, address: staking, abi: heimdallStakingAbi, functionName: "totalStaked" },
    { chainId: chain.id, address: staking, abi: heimdallStakingAbi, functionName: "rewardPerDay" },
    { chainId: chain.id, address: staking, abi: heimdallStakingAbi, functionName: "stakedOf", args: [me] },
    { chainId: chain.id, address: staking, abi: heimdallStakingAbi, functionName: "earned", args: [me] },
    { chainId: chain.id, address: heim, abi: ERC20, functionName: "balanceOf", args: [me] },
    { chainId: chain.id, address: heim, abi: ERC20, functionName: "allowance", args: [me, staking] },
  ], query: { refetchInterval: 15_000 } });
  const [total, perDay, mine, earned, bal, allowance] = (data ?? []).map((x) => x.result as bigint | undefined);
  const per1k = total && perDay ? (perDay * 7n * 1000n * 10n ** 18n) / total : undefined; // USDG per 1,000 HEIM per week
  let value = 0n; try { value = amt ? parseUnits(amt, 18) : 0n; } catch { value = 0n; }

  async function run(fn: () => Promise<`0x${string}`>, done: string, ev?: TrackEvent) {
    if (!pc) return;
    setBusy(true); setMsg(null);
    try {
      const hash = await fn();
      await pc.waitForTransactionReceipt({ hash }); setMsg(done); if (ev) track(ev);
      if (ev === "stake" && address) void fetch("/api/points/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: address, txHash: hash }) }).catch(() => {});
      setAmt(""); await refetch();
    }
    catch (e) { setMsg((e as { shortMessage?: string }).shortMessage ?? "Cancelled."); }
    finally { setBusy(false); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (value === 0n) return;
    if (tab === "stake") {
      if ((allowance ?? 0n) < value) await run(() => writeContractAsync({ address: heim, abi: ERC20, functionName: "approve", args: [staking, value] }), "Approved.");
      await run(() => writeContractAsync({ address: staking, abi: heimdallStakingAbi, functionName: "stake", args: [value] }), "Staked.", "stake");
    } else await run(() => writeContractAsync({ address: staking, abi: heimdallStakingAbi, functionName: "withdraw", args: [value] }), "Withdrawn.", "unstake");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="card p-5"><p className="text-[13px] text-muted">Total staked</p><p className="mt-1 font-mono text-[26px] font-semibold">{f(total, 18, 0)} <span className="text-[15px] text-muted">HEIM</span></p></div>
        <div className="card p-5"><p className="text-[13px] text-muted">Paid to stakers now</p><p className="mt-1 font-mono text-[26px] font-semibold">{f(perDay, 6)} <span className="text-[15px] text-muted">USDG / day</span></p></div>
        <div className="card p-5"><p className="text-[13px] text-muted">Per 1,000 HEIM staked</p><p className="mt-1 font-mono text-[26px] font-semibold">{f(per1k, 6, 4)} <span className="text-[15px] text-muted">USDG / week</span></p></div>
        <div className="card p-5"><p className="text-[13px] text-muted">Your rewards</p><p className="mt-1 font-mono text-[26px] font-semibold text-allow">{f(earned, 6, 4)} <span className="text-[15px] text-muted">USDG</span></p>
          {address && (earned ?? 0n) > 0n && <button type="button" disabled={busy} onClick={() => run(() => writeContractAsync({ address: staking, abi: heimdallStakingAbi, functionName: "claim" }), "Rewards claimed.", "claim")} className="mt-3 text-[14px] font-semibold text-brand hover:underline disabled:opacity-50">Claim</button>}
        </div>
      </section>
      <form onSubmit={submit} className="card flex flex-col gap-4 p-6">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink-2 p-1">
          {(["stake", "withdraw"] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={`min-h-10 rounded-lg text-[15px] font-semibold capitalize ${tab === t ? "bg-white shadow-sm" : "text-muted"}`}>{t}</button>)}
        </div>
        <label className="flex flex-col gap-2 text-[14px] font-medium">Amount (HEIM)
          <input value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0.00" className="min-h-14 rounded-xl border border-line px-4 font-mono text-[22px] outline-none focus:border-brand" />
        </label>
        <div className="grid grid-cols-4 gap-2">
          {([25, 50, 75, 100] as const).map((pct) => {
            const base = (tab === "stake" ? bal : mine) ?? 0n;
            return <button key={pct} type="button" disabled={!address || base === 0n} onClick={() => setAmt(formatUnits((base * BigInt(pct)) / 100n, 18))} className="min-h-10 rounded-lg border border-line font-mono text-[13px] font-semibold hover:border-ink disabled:opacity-40">{pct === 100 ? "MAX" : `${pct}%`}</button>;
          })}
        </div>
        <div className="flex justify-between text-[14px] text-muted"><span>{tab === "stake" ? "Wallet" : "Staked"}</span><button type="button" className="font-mono hover:text-ink" onClick={() => setAmt(formatUnits((tab === "stake" ? bal : mine) ?? 0n, 18))}>{f(tab === "stake" ? bal : mine, 18)} HEIM</button></div>
        {address ? <button type="submit" disabled={busy || value === 0n} className="btn btn-primary min-h-12 disabled:opacity-50">{busy ? "Confirm in wallet…" : tab === "stake" ? "Stake" : "Withdraw"}</button> : <ConnectButton />}
        {msg && <p role="status" className="text-[14px] text-muted">{msg}</p>}
        <p className="text-[13px] leading-relaxed text-muted">No lock-up. Fees are streamed over 7 days after they arrive, so rewards build up second by second.</p>
      </form>
    </div>
  );
}
