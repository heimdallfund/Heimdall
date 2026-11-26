"use client";
import { useCallback } from "react";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { chain } from "./config";

/**
 * useWriteContract that always sends on Robinhood Chain. A wallet left on Ethereum (or any other network) is switched
 * first — the wallet adds Robinhood Chain if it does not know it — and the transaction is pinned to Robinhood Chain,
 * so nothing can ever be signed for the wrong network.
 */
export function useChainWrite() {
  const w = useWriteContract();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const writeContractAsync = useCallback(
    (async (args: Parameters<typeof w.writeContractAsync>[0], opts?: Parameters<typeof w.writeContractAsync>[1]) => {
      if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
      return w.writeContractAsync({ ...(args as object), chainId: chain.id } as typeof args, opts);
    }) as typeof w.writeContractAsync,
    [w, chainId, switchChainAsync],
  );
  return { ...w, writeContractAsync };
}
