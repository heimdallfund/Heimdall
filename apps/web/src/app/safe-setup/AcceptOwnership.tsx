"use client";
import { useEffect, useState } from "react";
import { concat, encodeFunctionData, encodePacked, getAddress, pad, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { ConnectButton } from "@/components/ConnectButton";
import { explorerAddress, explorerTx } from "@/lib/config";

const SAFE = getAddress("0xaF1c3b55D204899CEd14d23C996153bC82424168");
const OWNER = getAddress("0xdB09426BC12EF1FC70BD149e163FCB09179669c5");
const MULTISEND_CALL_ONLY = getAddress("0x9641d764fc13c8B624c04430C7356C1C7C8102e2"); // Safe 1.4.1
const CONTRACTS: [string, Address][] = [
  ["Vault factory", "0x838fdede1ae6fbdc15f784030d78ca7543d1154d"],
  ["Signals", "0x14bd445999dd254090ce86bfcf96df5d4a3e301d"],
  ["Pay", "0xd8bd0bfc6ad1c5cee42c4f64bfcea9555a170265"],
  ["Auto-Invest", "0xeacf613ff7d6dbc8acbf51b411ad092d48e5a932"],
  ["Risk Oracle", "0x84da850303db7cca6d5194b9d9f8f392a6c9e3e0"],
  ["Guard module", "0xd2a8815c10f1d71fc854edb7a78405db8fe86ae6"],
];
const ACCEPT = "0x79ba5097" as const; // acceptOwnership()
const OWNABLE = parseAbi(["function owner() view returns (address)", "function pendingOwner() view returns (address)"]);
const SAFE_ABI = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)"]);

// all six acceptOwnership calls in one MultiSendCallOnly batch (DELEGATECALL from the Safe)
const batch = encodeFunctionData({
  abi: parseAbi(["function multiSend(bytes transactions) payable"]),
  functionName: "multiSend",
  args: [concat(CONTRACTS.map(([, to]) => encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [0, to, 0n, 4n, ACCEPT])))],
});
// v = 1: "the owner is the caller" signature, so the owner only sends one transaction, nothing to sign separately
const OWNER_SIG = concat([pad(OWNER), pad("0x0"), "0x01"]) as Hex;

export function AcceptOwnership() {
  const { address, chainId } = useAccount();
  const pc = usePublicClient({ chainId: 4663 });
  const { writeContractAsync, isPending } = useWriteContract();
  const [owners, setOwners] = useState<Record<string, Address> | null>(null);
  const [tx, setTx] = useState<Hex | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (!pc) return;
    const res = await Promise.all(CONTRACTS.map(([, a]) => pc.readContract({ address: a, abi: OWNABLE, functionName: "owner" }).catch(() => zeroAddress as Address)));
    setOwners(Object.fromEntries(CONTRACTS.map(([, a], i) => [a, res[i]])));
  }
  useEffect(() => { load(); }, [pc]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = !!owners && CONTRACTS.every(([, a]) => owners[a] && getAddress(owners[a]) === SAFE);
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
        {CONTRACTS.map(([n, a]) => {
          const o = owners?.[a];
          const ok = !!o && getAddress(o) === SAFE;
          return (
            <li key={a} className="flex items-center justify-between gap-3">
              <a href={explorerAddress(a)} target="_blank" rel="noopener" className="font-medium hover:underline">{n}</a>
              <span className={`rounded-sm px-2 py-0.5 text-[12px] font-semibold ${ok ? "bg-allow-soft text-allow" : "bg-warn-soft text-warn"}`}>{owners ? (ok ? "Owned by the Safe" : "Waiting") : "…"}</span>
            </li>
          );
        })}
      </ul>
      {done ? (
        <p className="rounded-lg bg-allow-soft px-4 py-3 text-[15px] font-semibold text-allow">Done. The Safe owns every contract.</p>
      ) : !address ? (
        <ConnectButton />
      ) : !isOwner ? (
        <p className="text-[14.5px] text-deny">Connected wallet is not the Safe owner. Connect {OWNER.slice(0, 6)}…{OWNER.slice(-4)}.</p>
      ) : chainId !== 4663 ? (
        <ConnectButton />
      ) : (
        <button type="button" onClick={run} disabled={isPending || !!tx} className="btn btn-primary min-h-12 px-6 disabled:opacity-50">
          {isPending ? "Confirm in your wallet…" : tx ? "Waiting for the block…" : "Accept ownership (1 transaction)"}
        </button>
      )}
      {tx && <a href={explorerTx(tx)} target="_blank" rel="noopener" className="font-mono text-[13px] text-brand hover:underline">{tx}</a>}
      {err && <p role="alert" className="text-[14px] text-deny">{err}</p>}
    </div>
  );
}
