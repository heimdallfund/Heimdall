import { defineChain, type Address } from "viem";

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
  contracts: {
    // Canonical Multicall3 (aggregate3), verified onchain 2026-11-23. 0x2cAC…DaD1 from the docs has no aggregate3.
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
});

export const SUPPORTED_CHAINS = {
  [robinhoodMainnet.id]: robinhoodMainnet,
  [robinhoodTestnet.id]: robinhoodTestnet,
} as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;

/** Pseudo-address used by eth_simulateV1 (traceTransfers) for native ETH movements. */
export const NATIVE_ASSET: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** Canonical contracts published in the Robinhood Chain docs (mainnet). */
export const KNOWN_CONTRACTS: Record<number, Record<string, { name: string; kind: "token" | "protocol" }>> = {
  4663: {
    "0x0bd7d308f8e1639fab988df18a8011f41eacad73": { name: "WETH", kind: "token" },
    "0x5fc5360d0400a0fd4f2af552add042d716f1d168": { name: "USDG", kind: "token" },
    "0x000000000022d473030f116ddee9f6b43ac78ba3": { name: "Permit2", kind: "protocol" },
    "0x2cac2d899ecc914d704feaae33ac1bf36277dad1": { name: "Multicall", kind: "protocol" },
  },
  46630: {
    "0x000000000022d473030f116ddee9f6b43ac78ba3": { name: "Permit2", kind: "protocol" },
    "0xa432504b6f04cafe775b09d8aa92e8dbe41ec7a8": { name: "Multicall", kind: "protocol" },
  },
};

// Heimdall's own deployed contracts, named once their addresses are set in the environment.
for (const [envKey, name] of [["HEIMDALL_PAY_ADDRESS", "Heimdall Pay"], ["HEIMDALL_FACTORY_ADDRESS", "Heimdall Vault Factory"], ["HEIMDALL_SIGNALS_ADDRESS", "Heimdall Signals"], ["HEIMDALL_STAKING_ADDRESS", "Heimdall Staking"]] as const) {
  const a = process.env[envKey];
  if (a && /^0x[0-9a-fA-F]{40}$/.test(a)) KNOWN_CONTRACTS[4663]![a.toLowerCase()] = { name, kind: "protocol" };
}

export function knownContract(chainId: number, address?: string | null) {
  if (!address) return undefined;
  return KNOWN_CONTRACTS[chainId]?.[address.toLowerCase()];
}
