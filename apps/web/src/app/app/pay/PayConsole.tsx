"use client";
import { track } from "@/lib/track";
import { useChainWrite } from "@/lib/chainWrite";
import Link from "next/link";
import { useMemo, useState } from "react";
import { isAddress, keccak256, parseUnits, toHex, type Address } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { heimdallPayAbi } from "@/lib/abi";
import { ADDRESSES, short, chain } from "@/lib/config";
import { NO_ARBITER, TONE, toJob, usdg, type PayJob } from "@/lib/pay";
import { ConnectButton } from "@/components/ConnectButton";

const ERC20 = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

export function PayConsole({ pay }: { pay: Address }) {
  const { address } = useAccount();
  const [role, setRole] = useState<"client" | "provider">("client");
  const me = address ?? NO_ARBITER;
  const { data: ids, refetch } = useReadContract({ chainId: chain.id, address: pay, abi: heimdallPayAbi, functionName: role === "client" ? "jobsOfClient" : "jobsOfProvider", args: [me], query: { enabled: !!address } });
  const list = useMemo(() => [...((ids as readonly bigint[] | undefined) ?? [])].reverse().slice(0, 30), [ids]);
  const { data: raw, refetch: refetchJobs } = useReadContracts({ contracts: list.map((id) => ({ address: pay, abi: heimdallPayAbi, functionName: "getJob", args: [id] })), query: { enabled: list.length > 0 } });
  const jobs: PayJob[] = (raw ?? []).flatMap((r, i) => (r.status === "success" ? [toJob(list[i], r.result as unknown as Record<string, unknown>)] : []));
  const reload = async () => { await refetch(); await refetchJobs(); };

  if (!address) return <div className="card flex flex-col items-start gap-3 p-6"><p className="text-[15px] text-muted">Connect a wallet to create jobs or see the ones you are part of.</p><ConnectButton /></div>;
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="card min-w-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink-2 p-1">
            {(["client", "provider"] as const).map((r) => <button key={r} type="button" onClick={() => setRole(r)} className={`min-h-9 rounded-lg px-4 text-[14px] font-semibold ${role === r ? "bg-white shadow-sm" : "text-muted"}`}>{r === "client" ? "I pay" : "I work"}</button>)}
          </div>
          <span className="text-[13px] text-muted">{jobs.length} job{jobs.length === 1 ? "" : "s"}</span>
        </div>
        {jobs.length === 0 ? <p className="px-5 py-10 text-center text-[15px] text-muted">{role === "client" ? "No jobs yet. Create one on the right." : "Nobody has hired this wallet yet."}</p> : (
          <ul className="divide-y divide-line">
            {jobs.map((j) => (
              <li key={String(j.id)}>
                <Link href={`/pay/job/${j.id}`} className="grid gap-2 px-5 py-4 hover:bg-ice sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                  <span className={`w-fit rounded-sm px-2.5 py-1 text-[12px] font-semibold ${TONE[j.status]}`}>{j.status}</span>
                  <span className="min-w-0 truncate text-[14.5px]"><span className="font-mono text-muted">#{String(j.id)}</span> · {role === "client" ? <>to <span className="font-mono">{short(j.provider)}</span></> : <>from <span className="font-mono">{short(j.client)}</span></>}</span>
                  <span className="font-mono text-[15px] font-semibold">{usdg(j.amount)} USDG</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <CreateJob pay={pay} onDone={reload} />
    </div>
  );
}

function CreateJob({ pay, onDone }: { pay: Address; onDone: () => Promise<void> }) {
  const { address } = useAccount();
  const pc = usePublicClient({ chainId: chain.id });
  const { writeContractAsync } = useChainWrite();
  const [f, setF] = useState({ provider: "", amount: "", days: "3", review: "24", arbiter: "", arbFee: "5", spec: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const valid = isAddress(f.provider) && Number(f.amount) >= 1 && Number(f.days) > 0 && Number(f.review) >= 1 && f.spec.trim().length > 3 && (!f.arbiter || isAddress(f.arbiter));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pc || !address || !valid) return;
    setBusy(true); setMsg(null);
    try {
      const amount = parseUnits(f.amount, 6);
      const allowance = await pc.readContract({ address: ADDRESSES.usdg, abi: ERC20, functionName: "allowance", args: [address, pay] });
      if (allowance < amount) await pc.waitForTransactionReceipt({ hash: await writeContractAsync({ address: ADDRESSES.usdg, abi: ERC20, functionName: "approve", args: [pay, amount] }) });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + Math.round(Number(f.days) * 86_400));
      const arbiter = (f.arbiter || NO_ARBITER) as Address;
      const hash = await writeContractAsync({ address: pay, abi: heimdallPayAbi, functionName: "createJob",
        args: [f.provider as Address, arbiter, amount, deadline, Math.round(Number(f.review) * 3600), f.arbiter ? Math.round(Number(f.arbFee) * 100) : 0, keccak256(toHex(f.spec.trim()))] });
      await pc.waitForTransactionReceipt({ hash });
      track("pay_job_created");
      void fetch("/api/points/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: address, txHash: hash }) }).catch(() => {});
      setMsg({ ok: true, text: "Job created and funded. Send the provider the exact task text: its hash is now onchain." });
      setF({ ...f, provider: "", amount: "", spec: "" });
      await onDone();
    } catch (err) { setMsg({ ok: false, text: (err as { shortMessage?: string }).shortMessage ?? "Cancelled." }); }
    finally { setBusy(false); }
  }
  const input = "min-h-11 rounded-lg border border-line px-3 text-[14px] outline-none focus:border-brand";
  return (
    <form onSubmit={submit} className="card flex flex-col gap-3.5 p-5">
      <h2 className="text-[17px] font-semibold">Hire an agent</h2>
      <label className="flex flex-col gap-1.5 text-[13.5px] font-medium">Provider wallet<input className={`${input} font-mono`} value={f.provider} onChange={set("provider")} placeholder="0x…" spellCheck={false} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-[13.5px] font-medium">Amount (USDG)<input className={`${input} font-mono`} value={f.amount} onChange={set("amount")} inputMode="decimal" placeholder="25" /></label>
        <label className="flex flex-col gap-1.5 text-[13.5px] font-medium">Deadline (days)<input className={`${input} font-mono`} value={f.days} onChange={set("days")} inputMode="decimal" /></label>
      </div>
      <label className="flex flex-col gap-1.5 text-[13.5px] font-medium">Task<textarea className={`${input} py-2`} rows={3} value={f.spec} onChange={set("spec")} placeholder="What the provider must deliver, or a link to the brief" /></label>
      <details className="text-[13.5px]"><summary className="cursor-pointer font-medium text-muted">Review window and arbiter</summary>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 font-medium">Review window (hours, 1–720)<input className={`${input} font-mono`} value={f.review} onChange={set("review")} inputMode="numeric" /></label>
          <label className="flex flex-col gap-1.5 font-medium">Arbiter for disputes (optional)<input className={`${input} font-mono`} value={f.arbiter} onChange={set("arbiter")} placeholder="0x… leave empty for no disputes" spellCheck={false} /></label>
          {f.arbiter && <label className="flex flex-col gap-1.5 font-medium">Arbiter fee (%, max 10)<input className={`${input} font-mono`} value={f.arbFee} onChange={set("arbFee")} inputMode="decimal" /></label>}
        </div>
      </details>
      <button type="submit" disabled={!valid || busy} className="btn btn-primary min-h-11 disabled:opacity-50">{busy ? "Confirm in wallet…" : `Escrow ${f.amount || "0"} USDG`}</button>
      {msg && <p role="status" className={`text-[13.5px] ${msg.ok ? "text-allow" : "text-deny"}`}>{msg.text}</p>}
      <p className="text-[12.5px] leading-relaxed text-muted">1% fee on what the provider receives, paid to $HEIM stakers. If nothing is delivered by the deadline, anyone can refund you.</p>
    </form>
  );
}
