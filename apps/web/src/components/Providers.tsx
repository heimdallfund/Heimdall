"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { chain } from "@/lib/config";

const wcId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected(), ...(wcId ? [walletConnect({ projectId: wcId, showQrModal: true })] : [])],
  transports: { [chain.id]: http() },
  ssr: true,
});

// One query client for every wallet island, so they share cache and connection state.
const qc = new QueryClient();

/** Wallet context. Mounted only where a wallet is used (app area, deposit, create, list) — not on marketing pages. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
