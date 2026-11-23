"use client";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chain, short } from "@/lib/config";

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (isConnected && address) {
    if (chainId !== chain.id) {
      return (
        <button type="button" onClick={() => switchChain({ chainId: chain.id })} className="min-h-10 rounded-lg bg-deny px-3.5 text-[13px] font-semibold text-white">
          Switch to {chain.name}
        </button>
      );
    }
    return (
      <button type="button" onClick={() => disconnect()} title="Disconnect" className="min-h-10 rounded-lg bg-brand px-3.5 font-mono text-[13px] text-white">
        {short(address)}
      </button>
    );
  }
  return (
    <div className="flex gap-2">
      {connectors.map((c) => (
        <button key={c.uid} type="button" disabled={isPending} onClick={() => connect({ connector: c, chainId: chain.id })}
          className="min-h-10 rounded-lg bg-brand px-3.5 text-[13px] font-semibold text-white disabled:opacity-60">
          {c.id === "injected" ? "Connect wallet" : c.name}
        </button>
      ))}
    </div>
  );
}
