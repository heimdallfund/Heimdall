"use client";
import { useEffect, useState } from "react";
import { concat, getAddress, pad, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { useChainWrite } from "@/lib/chainWrite";
import { ConnectButton } from "@/components/ConnectButton";
import { explorerTx } from "@/lib/config";
import { BATCH_DATA as data, MULTISEND_CALL_ONLY, NONCE, SAFE, SAFE_ABI } from "./batch";

const NAMES: Record<string, string> = {
  "0xdB09426BC12EF1FC70BD149e163FCB09179669c5": "Owner",
  "0xc30CAa1545F7e8C0d6A0E6cC48D7Bc3f81e0d12A": "Signer 2",
  "0x925eC8944BC434E82F66328C5CE338a56D0914DF": "Signer 3 (backup)",
};

export function SafeBatch() {
  const { address } = useAccount();
  const pc = usePublicClient({ chainId: 4663 });
  const { writeContractAsync, isPending } = useChainWrite();
  const [st, setSt] = useState<{ owners: Address[]; threshold: bigint; nonce: bigint; hash: Hex; approved: Address[] } | null>(null);
  const [tx, setTx] = useState<Hex | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/safe-setup", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error();
      setErr(null);
      setSt({ owners: j.owners, threshold: BigInt(j.threshold), nonce: BigInt(j.nonce), hash: j.hash, approved: j.approved });
    } catch {
      setErr("Could not read the Safe. Refresh the page.");
    }
  }
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const me = address ? getAddress(address) : null;
  const isSigner = !!me && !!st?.owners.includes(me);
  const done = !!st && st.nonce > NONCE;
  const wrongNonce = !!st && st.nonce < NONCE;
  const othersApproved = st ? st.approved.filter((a) => a !== me) : [];
  const canExecute = !!st && isSigner && BigInt(othersApproved.length + 1) >= st.threshold;
  const iApproved = !!me && !!st?.approved.includes(me);

  async function send(fn: () => Promise<Hex>) {
    setErr(null);
    try {
      const hash = await fn();
      setTx(hash);
      // the public RPC can rate-limit; the 15 s refresh picks the result up either way
      await pc?.waitForTransactionReceipt({ hash, timeout: 120_000 }).catch(() => undefined);
      setTx(null);
      await load();
    } catch (e) {
      setTx(null);
      setErr((e as { shortMessage?: string }).shortMessage ?? "The transaction was not sent.");
    }
  }
  const approve = () => send(() => writeContractAsync({ address: SAFE, abi: SAFE_ABI, functionName: "approveHash", args: [st!.hash], chainId: 4663 }));
  const execute = () => send(() => {
    // v = 1 signatures: pre-approved hashes from the others, plus the caller itself; sorted by signer address
    const signers = [...othersApproved.slice(0, Number(st!.threshold) - 1), me!].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    const sigs = concat(signers.map((s) => concat([pad(s), pad("0x0"), "0x01"]))) as Hex;
    return writeContractAsync({ address: SAFE, abi: SAFE_ABI, functionName: "execTransaction", args: [MULTISEND_CALL_ONLY, 0n, data, 1, 0n, 0n, 0n, zeroAddress, zeroAddress, sigs], chainId: 4663 });
  });

  return (
    <div className="card flex flex-col gap-5 p-6">
      <ul className="flex flex-col gap-2 text-[14.5px]">
        {(st?.owners ?? Object.keys(NAMES).map((a) => getAddress(a))).map((a) => (
          <li key={a} className="flex items-center justify-between gap-3">
            <span className="font-medium">{NAMES[a] ?? "Signer"} <span className="font-mono text-[12.5px] text-muted">{a.slice(0, 6)}…{a.slice(-4)}</span></span>
            <span className={`rounded-sm px-2 py-0.5 text-[12px] font-semibold ${done || st?.approved.includes(a) ? "bg-allow-soft text-allow" : "bg-warn-soft text-warn"}`}>
              {!st ? "…" : done ? "Done" : st.approved.includes(a) ? "Approved" : "Not yet"}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3">
          <span className="font-medium">Signatures needed</span>
          <span className="font-mono text-[13px]">{st ? `${st.threshold} of ${st.owners.length}` : "…"}</span>
        </li>
      </ul>
      {done ? (
        <p className="rounded-lg bg-allow-soft px-4 py-3 text-[15px] font-semibold text-allow">Done. Every Heimdall fee now goes to the splitter (50% to $HEIM stakers) and the 5,000,000 $HEIM holder terms are on.</p>
      ) : wrongNonce ? (
        <p className="text-[14.5px] text-deny">An earlier Safe transaction is still pending. Ask Heimdall to rebuild this page.</p>
      ) : !address ? (
        <ConnectButton />
      ) : !st ? (
        <p className="text-[14.5px] text-muted">Reading the Safe…</p>
      ) : !isSigner ? (
        <p className="text-[14.5px] text-deny">This wallet is not a signer of the admin Safe.</p>
      ) : canExecute ? (
        <button type="button" onClick={execute} disabled={isPending || !!tx} className="btn btn-primary min-h-12 px-6 disabled:opacity-50">
          {isPending ? "Confirm in your wallet…" : tx ? "Waiting for the block…" : "Execute (signature 2 of 2)"}
        </button>
      ) : iApproved ? (
        <p className="rounded-lg bg-ice px-4 py-3 text-[15px]">Approved. Now open this page with a second signer wallet and press Execute.</p>
      ) : (
        <button type="button" onClick={approve} disabled={isPending || !!tx} className="btn btn-primary min-h-12 px-6 disabled:opacity-50">
          {isPending ? "Confirm in your wallet…" : tx ? "Waiting for the block…" : "Approve (signature 1 of 2)"}
        </button>
      )}
      {tx && <a href={explorerTx(tx)} target="_blank" rel="noopener" className="font-mono text-[13px] text-brand hover:underline">{tx}</a>}
      {err && <p role="alert" className="text-[14px] text-deny">{err}</p>}
    </div>
  );
}
