"use client";
import { track } from "@/lib/track";
import { useChainWrite } from "@/lib/chainWrite";
import { useState } from "react";
import { formatUnits, parseAbi, parseUnits, type Address } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { ADDRESSES } from "@/lib/config";
import { heimdallVaultAbi } from "@/lib/abi";
import { ConnectButton } from "@/components/ConnectButton";

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);

export function DepositPanel({ vault, maxLossPct = 3, maxDailyLossPct = 5 }: { vault: Address; maxLossPct?: number; maxDailyLossPct?: number }) {
  const { address } = useAccount();
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const { writeContractAsync, data: hash, isPending, error } = useChainWrite();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash });

  const usdgBal = useReadContract({ address: ADDRESSES.usdg, abi: ERC20, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled: !!address } });
  const allowance = useReadContract({ address: ADDRESSES.usdg, abi: ERC20, functionName: "allowance", args: address ? [address, vault] : undefined, query: { enabled: !!address } });
  const shares = useReadContract({ address: vault, abi: heimdallVaultAbi, functionName: "balanceOf", args: address ? [address] : undefined, query: { enabled: !!address } });
  const sharesValue = useReadContract({ address: vault, abi: heimdallVaultAbi, functionName: "convertToAssets", args: [shares.data ?? 0n], query: { enabled: shares.data !== undefined } });
  const maxWithdraw = useReadContract({ address: vault, abi: heimdallVaultAbi, functionName: "maxWithdraw", args: address ? [address] : undefined, query: { enabled: !!address } });

  let parsed: bigint | null = null;
  try { parsed = amount ? parseUnits(amount, 6) : null; } catch { parsed = null; }
  const busy = isPending || confirming;
  const refetch = () => { usdgBal.refetch(); allowance.refetch(); shares.refetch(); sharesValue.refetch(); maxWithdraw.refetch(); };

  async function submit() {
    if (!address || !parsed) return;
    if (mode === "deposit") {
      if ((allowance.data ?? 0n) < parsed) await writeContractAsync({ address: ADDRESSES.usdg, abi: ERC20, functionName: "approve", args: [vault, parsed] });
      await writeContractAsync({ address: vault, abi: heimdallVaultAbi, functionName: "deposit", args: [parsed, address] });
      track("vault_deposit");
    } else {
      await writeContractAsync({ address: vault, abi: heimdallVaultAbi, functionName: "withdraw", args: [parsed, address, address] });
    }
    setAmount(""); setTimeout(refetch, 2500);
  }

  async function exitInKind() {
    if (!address || !shares.data) return;
    await writeContractAsync({ address: vault, abi: heimdallVaultAbi, functionName: "redeemInKind", args: [shares.data, address, address] });
    setTimeout(refetch, 2500);
  }

  const fmt = (v?: bigint) => (v === undefined ? "—" : Number(formatUnits(v, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 }));
  const tooMuch = parsed !== null && (mode === "deposit" ? parsed > (usdgBal.data ?? 0n) : parsed > (maxWithdraw.data ?? 0n));

  return (
    <section aria-labelledby="dep" className="overflow-hidden card">
      <div aria-hidden="true" className="bifrost h-1" />
      <div className="flex flex-col gap-4 p-6">
        <h2 id="dep" className="text-lg font-semibold">{mode === "deposit" ? "Deposit" : "Withdraw"}</h2>
        <div role="tablist" aria-label="Action" className="grid grid-cols-2 rounded-lg bg-[#F1F4F9] p-1">
          {(["deposit", "withdraw"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`min-h-10 rounded-lg text-sm capitalize ${mode === m ? "bg-panel font-semibold shadow-[0_1px_2px_rgba(14,22,48,0.08)]" : "text-muted"}`}>{m}</button>
          ))}
        </div>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">Amount (USDG)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal"
            className="min-h-14 rounded-xl border border-line-strong px-3.5 font-mono text-[22px] outline-none focus:border-violet" />
        </label>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between"><span className="text-muted">{mode === "deposit" ? "Wallet USDG" : "Withdrawable now"}</span><span className="font-mono">{fmt(mode === "deposit" ? usdgBal.data : maxWithdraw.data)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Your position</span><span className="font-mono">{fmt(sharesValue.data)} USDG</span></div>
          <div className="flex justify-between"><span className="text-muted">Withdraw fee</span><span className="font-mono">0%</span></div>
          {mode === "deposit" && (
            <div className="mt-2 rounded-lg border border-line bg-ice p-3.5">
              <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">Worst case, enforced onchain</div>
              {(() => {
                const amt = parsed !== null ? Number(parsed) / 1e6 : 1000;
                const f = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });
                return (
                  <ul className="mt-2 flex flex-col gap-1.5 text-[13.5px]">
                    <li className="flex justify-between gap-3"><span>One bad trade can cost at most</span><span className="whitespace-nowrap font-mono font-semibold">{f(amt * maxLossPct / 100)} USDG</span></li>
                    <li className="flex justify-between gap-3"><span>A full day of bad trades, at most</span><span className="whitespace-nowrap font-mono font-semibold">{f(amt * maxDailyLossPct / 100)} USDG</span></li>
                    <li className="flex justify-between gap-3"><span>Manager can withdraw</span><span className="font-semibold text-allow">0 USDG</span></li>
                    <li className="text-[12px] text-muted">{parsed === null ? "Example for 1,000 USDG. " : ""}Limits are per vault NAV; you can exit in kind at any time. Price moves of the stocks themselves are not capped.</li>
                  </ul>
                );
              })()}
            </div>
          )}
        </div>
        {!address ? <ConnectButton /> : (
          <button type="button" disabled={!parsed || tooMuch || busy} onClick={submit}
            className="btn btn-primary min-h-[52px] disabled:opacity-50">
            {busy ? "Confirm in wallet…" : tooMuch ? "Amount too high" : mode === "deposit" ? "Deposit USDG" : "Withdraw USDG"}
          </button>
        )}
        {mode === "withdraw" && !!shares.data && (
          <button type="button" disabled={busy} onClick={exitInKind} className="min-h-11 rounded-xl border border-line-strong font-semibold disabled:opacity-50">
            Exit everything in kind (USDG + stock tokens)
          </button>
        )}
        {error && <p role="alert" className="text-sm text-deny">{error.message.split("\n")[0]}</p>}
      </div>
    </section>
  );
}
