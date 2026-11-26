import { formatUnits, parseAbi, type Address, type Hex } from "viem";
import { SHIELD_API_URL } from "./config";
import { client } from "./reads";
import { heimAddress } from "./heim";
import { readHeimSupply } from "./heimSupply";

/** Chainlink ETH/USD on Robinhood Chain. */
const ETH_USD: Address = "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9";
const STATE_VIEW: Address = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b";
const CURVE = parseAbi(["function curve() view returns (address)", "function getReserves() view returns (uint256, uint256)", "function graduated() view returns (bool)", "function graduationThreshold() view returns (uint256)", "function totalSupply() view returns (uint256)"]);
const FEED = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)", "function decimals() view returns (uint8)"]);
const SV = parseAbi(["function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"]);

export interface HeimMarket {
  token: Address;
  priceEth: number | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  holders: number | null;
  /** Still on the Pons bonding curve: how far to graduation. Null once graduated. */
  progressPct: number | null;
  graduated: boolean | null;
  staked: number | null;
  circulating: number | null;
  verdict: "ALLOW" | "WARN" | "DENY" | null;
}

async function ethUsd(): Promise<number | null> {
  const [round, dec] = await Promise.all([client.readContract({ address: ETH_USD, abi: FEED, functionName: "latestRoundData" }), client.readContract({ address: ETH_USD, abi: FEED, functionName: "decimals" })]).catch(() => [null, null] as const);
  return round ? Number(formatUnits(round[1], Number(dec))) : null;
}

/** Live $HEIM market data: price from its Pons curve (or its Uniswap v4 pool once graduated), holders from Token Check. */
export async function readHeimMarket(): Promise<HeimMarket | null> {
  const token = await heimAddress();
  if (!token) return null;
  type Check = { verdict: HeimMarket["verdict"]; holders?: { count: number } | null; launch?: { graduated: boolean | null; progressPct: number | null } | null; pool?: { version?: number; address: string } | null };
  const [check, supply, usd, curve] = await Promise.all([
    fetch(`${SHIELD_API_URL}/v1/token/${token}`, { signal: AbortSignal.timeout(30_000), next: { revalidate: 60 } }).then((r) => (r.ok ? (r.json() as Promise<Check>) : null)).catch(() => null),
    readHeimSupply().catch(() => null),
    ethUsd(),
    client.readContract({ address: token, abi: CURVE, functionName: "curve" }).catch(() => null),
  ]);
  let priceEth: number | null = null;
  let graduated: boolean | null = check?.launch?.graduated ?? null;
  let liveProgress: number | null = null;
  if (curve) {
    const [res, grad, thr, sup] = await Promise.all([
      client.readContract({ address: curve, abi: CURVE, functionName: "getReserves" }).catch(() => null),
      client.readContract({ address: curve, abi: CURVE, functionName: "graduated" }).catch(() => null),
      client.readContract({ address: curve, abi: CURVE, functionName: "graduationThreshold" }).catch(() => null),
      client.readContract({ address: token, abi: CURVE, functionName: "totalSupply" }).catch(() => null),
    ]);
    if (grad !== null) graduated = grad;
    // live progress: real ETH raised over the threshold (the reserve also holds a virtual 1.68 ETH that is never paid in)
    if (!graduated && res && thr && sup && thr > 0n && sup > 0n) {
      const virtual = (res[0] * res[1]) / sup;
      liveProgress = Math.min(100, Number(((res[0] > virtual ? res[0] - virtual : 0n) * 10_000n) / thr) / 100);
    }
    // on the curve the price is its reserves: ETH (virtual + raised) over tokens left
    if (!graduated && res && res[1] > 0n) priceEth = Number(formatUnits(res[0], 18)) / Number(formatUnits(res[1], 18));
  }
  if (priceEth === null && check?.pool?.version === 4) {
    // graduated: the Uniswap v4 pool against ETH (currency0) gives tokens per ETH
    const slot = await client.readContract({ address: STATE_VIEW, abi: SV, functionName: "getSlot0", args: [check.pool.address as Hex] }).catch(() => null);
    if (slot && slot[0] > 0n) { const p = Number(slot[0]) / 2 ** 96; priceEth = 1 / (p * p); }
  }
  const circulating = supply ? Number(supply.circulating) : null;
  const priceUsd = priceEth !== null && usd !== null ? priceEth * usd : null;
  return {
    token, priceEth, priceUsd, marketCapUsd: priceUsd !== null && circulating !== null ? priceUsd * circulating : null,
    holders: check?.holders?.count ?? null, progressPct: graduated ? null : liveProgress ?? check?.launch?.progressPct ?? null, graduated,
    staked: supply?.staked != null ? Number(supply.staked) : null, circulating, verdict: check?.verdict ?? null,
  };
}
