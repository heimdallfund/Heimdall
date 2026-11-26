"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { WagmiProvider, createConfig, fallback, http } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { chain } from "@/lib/config";

const wcId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [chain],
  // browser wallets announce themselves (EIP-6963) and are added automatically; WalletConnect covers phone wallets
  // (Robinhood Wallet, MetaMask, Trust, Rainbow…) by QR code or deep link; Coinbase Wallet has its own SDK
  connectors: [
    injected(),
    ...(wcId ? [walletConnect({
      projectId: wcId, showQrModal: true,
      metadata: { name: "Heimdall", description: "The guardian layer for AI agents on Robinhood Chain", url: "https://heimdall.fund", icons: ["https://heimdall.fund/apple-icon.png"] },
      qrModalOptions: { themeMode: "light" },
    })] : []),
    coinbaseWallet({ appName: "Heimdall", appLogoUrl: "https://heimdall.fund/apple-icon.png", preference: { options: "eoaOnly" } }),
  ],
  // reads go through our own origin first (some phone networks and in-app browsers cannot reach the public RPC), then direct
  transports: { [chain.id]: typeof window === "undefined" ? http() : fallback([http(`${window.location.origin}/api/rpc`, { batch: true }), http()]) },
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
