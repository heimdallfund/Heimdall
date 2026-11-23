import { defineChain, type Address, type Chain } from "viem";

export const robinhoodChain: Chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

export const robinhoodTestnet: Chain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL_TESTNET ?? "https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" } },
  testnet: true,
});

export const chain: Chain = process.env.NEXT_PUBLIC_CHAIN === "testnet" ? robinhoodTestnet : robinhoodChain;

const addr = (v?: string) => (v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined);

export const ADDRESSES = {
  usdg: addr(process.env.NEXT_PUBLIC_USDG_ADDRESS) ?? ("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address),
  factory: addr(process.env.NEXT_PUBLIC_FACTORY_ADDRESS),
  signals: addr(process.env.NEXT_PUBLIC_SIGNALS_ADDRESS),
  heim: addr(process.env.NEXT_PUBLIC_HEIM_ADDRESS),
  /** HeimdallHolderBalance: $HEIM held + staked, used for every holder check. */
  heimHolder: addr(process.env.NEXT_PUBLIC_HEIM_HOLDER_ADDRESS),
  staking: addr(process.env.NEXT_PUBLIC_STAKING_ADDRESS),
  splitter: addr(process.env.NEXT_PUBLIC_SPLITTER_ADDRESS),
  pay: addr(process.env.NEXT_PUBLIC_PAY_ADDRESS),
  autoInvest: addr(process.env.NEXT_PUBLIC_AUTOINVEST_ADDRESS),
};

export const SHIELD_API_URL = process.env.SHIELD_API_URL ?? "http://127.0.0.1:8787";
export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.heimdall.fund";

export const explorerAddress = (a: string) => `${chain.blockExplorers?.default.url}/address/${a}`;
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const explorerTx = (h: string) => `${chain.blockExplorers?.default.url}/tx/${h}`;

/** $HEIM balance (18 decimals) that unlocks holder benefits. Default 100,000 HEIM. */
export const HEIM_HOLDER_MIN = BigInt(process.env.NEXT_PUBLIC_HEIM_HOLDER_MIN ?? "100000000000000000000000");

/** Stocks Auto-Invest can buy (Chainlink 24/7 feeds). Override with NEXT_PUBLIC_INVEST_TOKENS='[{"symbol":"NVDA","address":"0x…"}]'. */
export const INVEST_TOKENS: { symbol: string; name: string; address: Address }[] = (() => {
  try { if (process.env.NEXT_PUBLIC_INVEST_TOKENS) return JSON.parse(process.env.NEXT_PUBLIC_INVEST_TOKENS); } catch { /* default */ }
  return [
    { symbol: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
    { symbol: "TSLA", name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" },
    { symbol: "GOOGL", name: "Alphabet", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3" },
  ];
})();
