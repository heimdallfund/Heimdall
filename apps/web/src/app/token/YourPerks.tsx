"use client";
import Link from "next/link";
import { formatUnits, parseAbi, type Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { chain } from "@/lib/config";
import { ConnectButton } from "@/components/ConnectButton";

const ABI = parseAbi(["function balanceOf(address) view returns (uint256)", "function stakedOf(address) view returns (uint256)"]);
const MIN = 5_000_000n * 10n ** 18n;
const fmt = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Connect a wallet and see whether it already gets the holder benefits: $HEIM held plus staked, against the 5,000,000 line. */
export function YourPerks({ heim, holder, staking }: { heim: Address; holder?: Address; staking?: Address }) {
  const { address } = useAccount();
  const me = address ?? "0x0000000000000000000000000000000000000000";
  const q = { enabled: !!address, refetchInterval: 20_000 };
  const heldQ = useReadContract({ chainId: chain.id, address: heim, abi: ABI, functionName: "balanceOf", args: [me], query: q });
  const stakedQ = useReadContract({ chainId: chain.id, address: staking ?? heim, abi: ABI, functionName: "stakedOf", args: [me], query: { ...q, enabled: !!address && !!staking } });
  const data = heldQ.data === undefined ? undefined : [heldQ.data, staking ? stakedQ.data ?? 0n : 0n];
  void holder;
  if (!address) {
    return (
      <div className="card flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="font-semibold">Do you already get the holder benefits?</p><p className="text-[14px] text-muted">Connect a wallet to check it against the 5,000,000 $HEIM line (held plus staked).</p></div>
        <ConnectButton />
      </div>
    );
  }
  const held = data?.[0] ?? 0n;
  const staked = data?.[1] ?? 0n;
  const total = held + staked;
  const ok = total >= MIN;
  const pct = Number((total * 10_000n) / MIN) / 100;
  return (
    <div className={`card flex flex-col gap-4 p-6 ${ok ? "border-allow" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[18px] font-semibold">{data === undefined ? "Checking your wallet…" : ok ? "Holder benefits: on" : "Holder benefits: not yet"}</p>
        <p className="font-mono text-[14px] text-muted">{fmt(held)} held + {fmt(staked)} staked = <b className="text-ink">{fmt(total)}</b> / 5,000,000</p>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-ice"><div className={`h-full ${ok ? "bg-allow" : "bg-brand"}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <p className="text-[14px] text-muted">{ok
        ? "This wallet gets 5,000 free Shield checks a day, the 95/5 Signals split, the 12.5% vault fee and the Guardian badge."
        : <>Add <b className="text-ink">{fmt(MIN - total)} $HEIM</b> to this wallet (held or staked) to switch them on.</>}
        {staking && <> <Link href="/stake" className="font-semibold text-brand hover:underline">Stake to earn USDG →</Link></>}</p>
    </div>
  );
}
