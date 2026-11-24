import type { Address } from "viem";

/**
 * Robinhood Chain mainnet tokens and spenders Heimdall knows by name.
 * Stock tokens and feeds were verified onchain on 2026-11-23 and 2026-11-24 (symbol(), name(), oraclePaused() and Chainlink
 * latestRoundData() against the Uniswap USDG pool price).
 * The wallet scanner also discovers tokens it does not list here (recent approvals, explorer token lists).
 */
export interface KnownToken { symbol: string; decimals: number; feed?: Address; stable?: boolean }

export const TOKENS: Record<string, KnownToken> = {
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168": { symbol: "USDG", decimals: 6, stable: true },
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73": { symbol: "WETH", decimals: 18, feed: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9" },
  "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec": { symbol: "NVDA", decimals: 18, feed: "0x321A36e441DfBadA01Aa6f9884F14a344E133D1F" },
  "0x322f0929c4625ed5bad873c95208d54e1c003b2d": { symbol: "TSLA", decimals: 18, feed: "0x39eDf5ef54150A30d2C4F1b982FbB8f93050BC37" },
  "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3": { symbol: "GOOGL", decimals: 18, feed: "0x53e040D2C8c9278cBc4b702328aC652068a0E063" },
  "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9": { symbol: "AAPL", decimals: 18, feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0" },
  "0xe93237c50d904957cf27e7b1133b510c669c2e74": { symbol: "MSFT", decimals: 18, feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E" },
  "0x12f190a9f9d7d37a250758b26824b97ce941bf54": { symbol: "AMZN", decimals: 18, feed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C" },
  "0xc0d6457c16cc70d6790dd43521c899c87ce02f35": { symbol: "META", decimals: 18, feed: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1" },
  "0x6330d8c3178a418788df01a47479c0ce7ccf450b": { symbol: "COIN", decimals: 18, feed: "0xA3a468A452940B7D6b69991207B508c609a98Ef2" },
  "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68": { symbol: "QQQ", decimals: 18, feed: "0x80901d846d5D7B030F26B480776EE3b29374C2ae" },
  "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea": { symbol: "SPCX", decimals: 18, feed: "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb" },
  "0x1b0e319c6a659f002271b69db8a7df2f911c153e": { symbol: "GME", decimals: 18, feed: "0x27C71df6A64fB476468EdF256CF72c038baB5B67" },
  "0xff080c8ce2e5feadaca0da81314ae59d232d4afd": { symbol: "MU", decimals: 18, feed: "0x425EEFdCf05ed6526C3cE61Af99429A228a6d596" },
  "0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5": { symbol: "CRCL", decimals: 18, feed: "0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a" },
  "0x941ae714ec6d8130c7b75d67160ca08f1e7d11dd": { symbol: "DELL", decimals: 18, feed: "0x1C6c8cADBe02E19129c39dDB92281cE4c0bf206b" },
  "0xa30fa36db767ad9ed3f7a60fc79526fb4d56d344": { symbol: "USO", decimals: 18, feed: "0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c" },
  "0x92fd66527192e3e61d4ddd13322aa222de86f9b5": { symbol: "SGOV", decimals: 18, feed: "0xa0DF4ee0fFf975306345875E3548Fcc519577A11" },
};

/** Spenders that are well-known protocol contracts. An approval to one of these is normal. */
export const KNOWN_SPENDERS: Record<string, string> = {
  "0xcaf681a66d020601342297493863e78c959e5cb2": "Uniswap SwapRouter02",
  "0x8876789976decbfcbbbe364623c63652db8c0904": "Uniswap UniversalRouter",
  "0x000000000022d473030f116ddee9f6b43ac78ba3": "Permit2",
};

export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export const knownToken = (a: string) => TOKENS[a.toLowerCase()];
if (process.env.HEIMDALL_PAY_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(process.env.HEIMDALL_PAY_ADDRESS)) KNOWN_SPENDERS[process.env.HEIMDALL_PAY_ADDRESS.toLowerCase()] = "Heimdall Pay";

export const knownSpender = (a: string) => KNOWN_SPENDERS[a.toLowerCase()];
