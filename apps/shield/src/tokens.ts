import { type Address, type PublicClient, parseAbi, formatUnits } from "viem";
import { NATIVE_ASSET } from "./chains.js";

const META_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

export interface TokenMeta { symbol: string; decimals: number }

const cache = new Map<string, TokenMeta>();

export async function tokenMeta(client: PublicClient, chainId: number, token: Address): Promise<TokenMeta> {
  if (token.toLowerCase() === NATIVE_ASSET.toLowerCase()) return { symbol: "ETH", decimals: 18 };
  const key = `${chainId}:${token.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address: token, abi: META_ABI, functionName: "symbol" }).catch(() => "UNKNOWN"),
    client.readContract({ address: token, abi: META_ABI, functionName: "decimals" }).catch(() => 0),
  ]);
  const meta = { symbol: String(symbol), decimals: Number(decimals) };
  cache.set(key, meta);
  return meta;
}

export function fmt(amount: bigint, decimals: number): string {
  const s = formatUnits(amount < 0n ? -amount : amount, decimals);
  const [i, f = ""] = s.split(".");
  const trimmed = f.slice(0, 6).replace(/0+$/, "");
  return trimmed ? `${i}.${trimmed}` : i!;
}
