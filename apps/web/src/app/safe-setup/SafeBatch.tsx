"use client";
import { useEffect, useState } from "react";
import { concat, encodeFunctionData, encodePacked, getAddress, pad, parseAbi, size, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { explorerTx } from "@/lib/config";
import { BATCH } from "./batch";

const SAFE = getAddress("0xaF1c3b55D204899CEd14d23C996153bC82424168");
const MULTISEND_CALL_ONLY = getAddress("0x9641d764fc13c8B624c04430C7356C1C7C8102e2"); // Safe 1.4.1
const NONCE = 2n; // the Safe nonce this batch is for; a later nonce means it already ran
const NAMES: Record<string, string> = {
  "0xdB09426BC12EF1FC70BD149e163FCB09179669c5": "Owner",
  "0xc30CAa1545F7e8C0d6A0E6cC48D7Bc3f81e0d12A": "Signer 2",
  "0x925eC8944BC434E82F66328C5CE338a56D0914DF": "Signer 3 (backup)",
};
const SAFE_ABI = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function approvedHashes(address owner, bytes32 hash) view returns (uint256)",
  "function approveHash(bytes32 hashToApprove)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
]);
const data = encodeFunctionData({
  abi: parseAbi(["function multiSend(bytes transactions) payable"]),
  functionName: "multiSend",
  args: [concat(BATCH.map((t) => encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [0, t.to, 0n, BigInt(size(t.data)), t.data])))],
});

export function SafeBatch() {
  const { address, chainId } = useAccount();
  const pc = usePublicClient({ chainId: 4663 });
  const { writeContractAsync, isPending } = useWriteContract();
  const [st, setSt] = useState<{ owners: Address[]; threshold: bigint; nonce: bigint; hash: Hex; approved: Address[] } | null>(null);
  const [tx, setTx] = useState<Hex | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!pc) return;
    try {
      const [owners, threshold, nonce] = await Promise.all([
        pc.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "getOwners" }),
        pc.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "getThreshold" }),
        pc.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "nonce" }),
      ]);
      const hash = await pc.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "getTransactionHash", args: [MULTISEND_CALL_ONLY, 0n, data, 1, 0n, 0n, 0n, zeroAddress, zeroAddress, NONCE] });
      const flags = await Promise.all(owners.map((o) => pc.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "approvedHashes", args: [o, hash] })));
      setSt({ owners: owners.map((o) => getAddress(o)), threshold, nonce, hash, approved: owners.filter((_, i) => flags[i] > 0n).map((o) => getAddress(o)) });
    } catch {
      setErr("Could not read the Safe. Refresh the page.");
    }
  }
  useEffect(() => { load(); }, [pc]); // eslint-disable-line react-hooks/exhaustive-deps

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
      await pc!.waitForTransactionReceipt({ hash });
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
        <p className="rounded-lg bg-allow-soft px-4 py-3 text-[15px] font-semibold text-allow">Done. The 13 stocks are live for new vaults and Auto-Invest.</p>
      ) : wrongNonce ? (
        <p className="text-[14.5px] text-deny">An earlier Safe transaction is still pending. Ask Heimdall to rebuild this page.</p>
      ) : !address || chainId !== 4663 ? (
        <ConnectButton />
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
