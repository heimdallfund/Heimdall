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
  riskOracle: addr(process.env.NEXT_PUBLIC_RISK_ORACLE_ADDRESS),
  guardModule: addr(process.env.NEXT_PUBLIC_GUARD_MODULE_ADDRESS),
};

/** Official ERC-8004 registries on Robinhood Chain (same address on every chain). */
export const ERC8004 = {
  identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address,
  reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as Address,
};

export const SHIELD_API_URL = process.env.SHIELD_API_URL ?? "http://127.0.0.1:8787";
export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.heimdall.fund";

export const explorerAddress = (a: string) => `${chain.blockExplorers?.default.url}/address/${a}`;
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const explorerTx = (h: string) => `${chain.blockExplorers?.default.url}/tx/${h}`;

/** $HEIM balance (18 decimals) that unlocks holder benefits. Default 5,000,000 HEIM. */
export const HEIM_HOLDER_MIN = BigInt(process.env.NEXT_PUBLIC_HEIM_HOLDER_MIN ?? "5000000000000000000000000");

/**
 * Stocks vaults and Auto-Invest can hold. NVDA, TSLA and GOOGL have 24/7 Chainlink feeds; the rest are priced on
 * weekdays only (closed Saturday 00:00 to Monday 01:00 UTC). Override with NEXT_PUBLIC_INVEST_TOKENS.
 */
export const INVEST_TOKENS: { symbol: string; name: string; address: Address; weekdays?: boolean }[] = (() => {
  try { if (process.env.NEXT_PUBLIC_INVEST_TOKENS) return JSON.parse(process.env.NEXT_PUBLIC_INVEST_TOKENS); } catch { /* default */ }
  return [
    { symbol: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
    { symbol: "TSLA", name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" },
    { symbol: "GOOGL", name: "Alphabet", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3" },
    { symbol: "AMZN", name: "Amazon", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", weekdays: true },
    { symbol: "AAPL", name: "Apple", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", weekdays: true },
    { symbol: "MSFT", name: "Microsoft", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", weekdays: true },
    { symbol: "META", name: "Meta Platforms", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", weekdays: true },
    { symbol: "COIN", name: "Coinbase", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", weekdays: true },
    { symbol: "QQQ", name: "Invesco QQQ", address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", weekdays: true },
    { symbol: "SPCX", name: "SpaceX", address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", weekdays: true },
    { symbol: "GME", name: "GameStop", address: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E", weekdays: true },
    { symbol: "MU", name: "Micron", address: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", weekdays: true },
    { symbol: "CRCL", name: "Circle", address: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", weekdays: true },
    { symbol: "DELL", name: "Dell", address: "0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd", weekdays: true },
    { symbol: "USO", name: "US Oil Fund", address: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344", weekdays: true },
    { symbol: "SGOV", name: "iShares 0-3M T-Bills", address: "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5", weekdays: true },
  ];
})();
