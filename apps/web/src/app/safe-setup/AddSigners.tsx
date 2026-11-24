"use client";
import { useEffect, useState } from "react";
import { concat, encodeFunctionData, encodePacked, getAddress, pad, parseAbi, size, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { explorerAddress, explorerTx } from "@/lib/config";

const SAFE = getAddress("0xaF1c3b55D204899CEd14d23C996153bC82424168");
const OWNER = getAddress("0xdB09426BC12EF1FC70BD149e163FCB09179669c5");
const MULTISEND_CALL_ONLY = getAddress("0x9641d764fc13c8B624c04430C7356C1C7C8102e2"); // Safe 1.4.1
const SIGNERS: [string, Address][] = [
  ["Owner (signer 1)", OWNER],
  ["Signer 2", getAddress("0xc30CAa1545F7e8C0d6A0E6cC48D7Bc3f81e0d12A")],
  ["Signer 3 (backup)", getAddress("0x925eC8944BC434E82F66328C5CE338a56D0914DF")],
];
const SAFE_ABI = parseAbi([
  "function addOwnerWithThreshold(address owner,uint256 _threshold)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
]);

// add signer 2 (threshold stays 1), then signer 3 with threshold 2, as one MultiSendCallOnly batch (DELEGATECALL from the Safe)
const calls = [encodeFunctionData({ abi: SAFE_ABI, functionName: "addOwnerWithThreshold", args: [SIGNERS[1][1], 1n] }),
  encodeFunctionData({ abi: SAFE_ABI, functionName: "addOwnerWithThreshold", args: [SIGNERS[2][1], 2n] })];
const batch = encodeFunctionData({
  abi: parseAbi(["function multiSend(bytes transactions) payable"]),
  functionName: "multiSend",
  args: [concat(calls.map((d) => encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [0, SAFE, 0n, BigInt(size(d)), d])))],
});
// v = 1: "the owner is the caller" signature, so the owner sends one transaction and signs nothing else
const OWNER_SIG = concat([pad(OWNER), pad("0x0"), "0x01"]) as Hex;

export function AddSigners() {
  const { address, chainId } = useAccount();
  const pc = usePublicClient({ chainId: 4663 });
  const { writeContractAsync, isPending } = useWriteContract();
  const [state, setState] = useState<{ owners: Address[]; threshold: bigint } | null>(null);
  const [tx, setTx] = useState<Hex | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!pc) return;
    const [owners, threshold] = await Promise.all([
      pc.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "getOwners" }),
      pc.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "getThreshold" }),
    ]);
    setState({ owners: owners.map((o) => getAddress(o)), threshold });
  }
  useEffect(() => { load(); }, [pc]); // eslint-disable-line react-hooks/exhaustive-deps

  const has = (a: Address) => !!state?.owners.includes(a);
  const done = !!state && SIGNERS.every(([, a]) => has(a)) && state.threshold === 2n;
  const isOwner = !!address && getAddress(address) === OWNER;

  async function run() {
    setErr(null);
    try {
      const hash = await writeContractAsync({
        address: SAFE, abi: SAFE_ABI, functionName: "execTransaction", chainId: 4663,
        args: [MULTISEND_CALL_ONLY, 0n, batch, 1, 0n, 0n, 0n, zeroAddress, zeroAddress, OWNER_SIG],
      });
      setTx(hash);
      await pc!.waitForTransactionReceipt({ hash });
      await load();
    } catch (e) {
      setErr((e as { shortMessage?: string }).shortMessage ?? "The transaction was not sent.");
    }
  }

  return (
    <div className="card flex flex-col gap-5 p-6">
      <ul className="flex flex-col gap-2 text-[14.5px]">
        {SIGNERS.map(([n, a]) => (
          <li key={a} className="flex items-center justify-between gap-3">
            <a href={explorerAddress(a)} target="_blank" rel="noopener" className="font-medium hover:underline">{n} <span className="font-mono text-[12.5px] text-muted">{a.slice(0, 6)}…{a.slice(-4)}</span></a>
            <span className={`rounded-sm px-2 py-0.5 text-[12px] font-semibold ${has(a) ? "bg-allow-soft text-allow" : "bg-warn-soft text-warn"}`}>{state ? (has(a) ? "Signer" : "Not yet") : "…"}</span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3">
          <span className="font-medium">Signatures required</span>
          <span className={`rounded-sm px-2 py-0.5 text-[12px] font-semibold ${state?.threshold === 2n ? "bg-allow-soft text-allow" : "bg-warn-soft text-warn"}`}>{state ? `${state.threshold} of ${state.owners.length}` : "…"}</span>
        </li>
      </ul>
      {done ? (
        <p className="rounded-lg bg-allow-soft px-4 py-3 text-[15px] font-semibold text-allow">Done. The admin Safe is 2 of 3.</p>
      ) : !address ? (
        <ConnectButton />
      ) : !isOwner ? (
        <p className="text-[14.5px] text-deny">Connected wallet is not the Safe owner. Connect {OWNER.slice(0, 6)}…{OWNER.slice(-4)}.</p>
      ) : chainId !== 4663 ? (
        <ConnectButton />
      ) : (
        <button type="button" onClick={run} disabled={isPending || !!tx} className="btn btn-primary min-h-12 px-6 disabled:opacity-50">
          {isPending ? "Confirm in your wallet…" : tx ? "Waiting for the block…" : "Add 2 signers, require 2 of 3 (1 transaction)"}
        </button>
      )}
      {tx && <a href={explorerTx(tx)} target="_blank" rel="noopener" className="font-mono text-[13px] text-brand hover:underline">{tx}</a>}
      {err && <p role="alert" className="text-[14px] text-deny">{err}</p>}
    </div>
  );
}
