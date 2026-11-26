"use client";
import { track, type TrackEvent } from "@/lib/track";
import { useChainWrite } from "@/lib/chainWrite";
import { useState } from "react";
import { keccak256, toHex, type Address } from "viem";
import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { heimdallPayAbi } from "@/lib/abi";
import { explorerAddress, short, chain } from "@/lib/config";
import { NO_ARBITER, TONE, toJob, usdg } from "@/lib/pay";
import { ConnectButton } from "@/components/ConnectButton";
import { ScanLoader } from "@/components/Motif";

const when = (s: bigint | number) => new Date(Number(s) * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export function JobView({ pay, id }: { pay: Address; id: bigint }) {
  const { address } = useAccount();
  const pc = usePublicClient({ chainId: chain.id });
  const { writeContractAsync } = useChainWrite();
  const { data, refetch, isLoading } = useReadContract({ chainId: chain.id, address: pay, abi: heimdallPayAbi, functionName: "getJob", args: [id], query: { refetchInterval: 20_000 } });
  const [text, setText] = useState(""); const [split, setSplit] = useState(50); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  if (isLoading) return <div className="flex justify-center py-16"><ScanLoader /></div>;
  if (!data) return <div className="card p-6 text-[15px]">Job #{String(id)} was not found.</div>;
  const j = toJob(id, data as unknown as Record<string, unknown>);
  if (j.status === "None") return <div className="card p-6 text-[15px]">Job #{String(id)} does not exist.</div>;

  const now = Math.floor(Date.now() / 1000);
  const me = address?.toLowerCase();
  const isClient = me === j.client.toLowerCase(), isProvider = me === j.provider.toLowerCase(), isArbiter = me === j.arbiter.toLowerCase();
  const releaseAt = Number(j.submittedAt) + j.reviewWindow;
  const canClaim = j.status === "Submitted" && now >= releaseAt;
  const canRefund = j.status === "Open" && now > Number(j.deadline);
  const hasArbiter = j.arbiter !== NO_ARBITER;
  const fee = (j.amount * BigInt(j.feeBps)) / 10_000n;
  const settleAt = Number(j.disputedAt) + 14 * 86_400;
  const canSettle = j.status === "Disputed" && now >= settleAt;

  async function run(fn: () => Promise<`0x${string}`>, done: string, ev?: TrackEvent) {
    if (!pc) return;
    setBusy(true); setMsg(null);
    try { await pc.waitForTransactionReceipt({ hash: await fn() }); setMsg(done); if (ev) track(ev); await refetch(); }
    catch (e) { setMsg((e as { shortMessage?: string }).shortMessage ?? "Cancelled."); }
    finally { setBusy(false); }
  }
  const w = (functionName: "submit" | "release" | "claim" | "refund" | "cancel" | "dispute" | "resolve" | "settleExpiredDispute" | "withdrawOwed", args: readonly unknown[]) =>
    () => writeContractAsync({ address: pay, abi: heimdallPayAbi, functionName, args: args as never });
  const btn = "min-h-11 rounded-lg px-5 text-[14.5px] font-semibold disabled:opacity-50";
  const matches = text.trim() && keccak256(toHex(text.trim()));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="card flex min-w-0 flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`rounded-sm px-3 py-1 text-[13px] font-semibold ${TONE[j.status]}`}>{j.status}</span>
          <span className="font-mono text-[28px] font-semibold">{usdg(j.amount)} <span className="text-[15px] text-muted">USDG</span></span>
        </div>
        <dl className="grid gap-3 text-[14.5px] sm:grid-cols-2">
          {[["Client (pays)", j.client], ["Provider (works)", j.provider], ["Arbiter", hasArbiter ? j.arbiter : null]].map(([k, v]) => (
            <div key={k as string} className="rounded-xl bg-ink-2 px-4 py-3"><dt className="text-[12.5px] text-muted">{k}</dt><dd className="mt-0.5 font-mono">{v ? <a href={explorerAddress(v as string)} target="_blank" rel="noopener" className="hover:underline">{short(v as string)}</a> : "None: no disputes"}</dd></div>
          ))}
          <div className="rounded-xl bg-ink-2 px-4 py-3"><dt className="text-[12.5px] text-muted">Fees</dt><dd className="mt-0.5">{j.feeBps / 100}% protocol ({usdg(fee)} USDG){hasArbiter ? ` · ${j.arbiterFeeBps / 100}% arbiter if disputed` : ""}</dd></div>
        </dl>
        <ol className="flex flex-col gap-2 border-l-2 border-line pl-4 text-[14px]">
          <li><span className="font-semibold">Funded.</span> Deadline {when(j.deadline)}{j.status === "Open" ? ` (${Math.max(0, Math.round((Number(j.deadline) - now) / 3600))} h left)` : null}.</li>
          {j.submittedAt > 0n && <li><span className="font-semibold">Delivered</span> {when(j.submittedAt)}. {j.status === "Submitted" ? <>Releases automatically {when(releaseAt)}.</> : null}</li>}
          {j.status === "Disputed" && <li><span className="font-semibold">Disputed</span> {when(j.disputedAt)}. If the arbiter has not ruled by {when(settleAt)}, anyone can split it 50/50.</li>}
          {["Released", "Refunded", "Resolved"].includes(j.status) && <li><span className="font-semibold">{j.status}.</span></li>}
        </ol>
        <div className="flex flex-col gap-2">
          <label className="text-[13.5px] font-medium" htmlFor="verify">Check a text against this job</label>
          <textarea id="verify" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the task (or the delivered result) to verify its hash" className="rounded-lg border border-line px-3 py-2 text-[14px] outline-none focus:border-brand" />
          {matches && <p className="text-[13.5px]">{matches === j.specHash ? <span className="font-semibold text-allow">Matches the task.</span> : matches === j.resultHash ? <span className="font-semibold text-allow">Matches the delivered result.</span> : <span className="text-deny">Matches neither the task nor the result.</span>}</p>}
        </div>
      </section>

      <aside className="card flex flex-col gap-3 p-5">
        <h2 className="text-[16px] font-semibold">Actions</h2>
        {!address && <ConnectButton />}
        {isProvider && j.status === "Open" && now <= Number(j.deadline) && <>
          <p className="text-[13.5px] text-muted">Deliver the work to the client, then submit the exact result text or link here. Its hash goes onchain.</p>
          {hasArbiter && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">Submitting accepts the arbiter {short(j.arbiter)}, chosen by the client. If you do not trust it, cancel instead.</p>}
          <button className={`${btn} bg-brand text-white`} disabled={busy || !text.trim()} onClick={() => run(w("submit", [id, keccak256(toHex(text.trim()))]), "Submitted. The review window has started.")}>Submit result above</button>
        </>}
        {isClient && (j.status === "Open" || j.status === "Submitted") && <button className={`${btn} bg-allow text-white`} disabled={busy} onClick={() => run(w("release", [id]), "Released to the provider.", "pay_released")}>Approve and release</button>}
        {isClient && j.status === "Submitted" && hasArbiter && now < releaseAt && <>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the dispute" className="min-h-11 rounded-lg border border-line px-3 text-[14px]" />
          <button className={`${btn} border border-deny text-deny`} disabled={busy || !reason.trim()} onClick={() => run(w("dispute", [id, reason.trim()]), "Disputed. The arbiter decides.")}>Dispute</button>
        </>}
        {isProvider && (j.status === "Open" || j.status === "Submitted") && <button className={`${btn} border border-line`} disabled={busy} onClick={() => run(w("cancel", [id]), "Cancelled. The client was refunded.")}>Cancel and refund client</button>}
        {isArbiter && j.status === "Disputed" && <>
          <label className="text-[13.5px] font-medium">Provider share: {split}%<input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="w-full" /></label>
          <button className={`${btn} bg-brand text-white`} disabled={busy} onClick={() => run(w("resolve", [id, split * 100]), "Resolved.")}>Resolve dispute</button>
        </>}
        {canSettle && <button className={`${btn} border border-line`} disabled={busy || !address} onClick={() => run(w("settleExpiredDispute", [id]), "Split 50/50 after the arbiter timed out.")}>Split 50/50 (arbiter timed out)</button>}
        {canClaim && <button className={`${btn} bg-allow text-white`} disabled={busy || !address} onClick={() => run(w("claim", [id]), "Released after the review window.")}>Release (review window passed)</button>}
        {canRefund && <button className={`${btn} border border-line`} disabled={busy || !address} onClick={() => run(w("refund", [id]), "Refunded to the client.")}>Refund client (deadline passed)</button>}
        {address && !isClient && !isProvider && !isArbiter && !canClaim && !canRefund && !canSettle && <p className="text-[13.5px] text-muted">Nothing to do here from this wallet.</p>}
        {msg && <p role="status" className="text-[13.5px] text-muted">{msg}</p>}
      </aside>
    </div>
  );
}
