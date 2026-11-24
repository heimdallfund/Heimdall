import { getAddress, parseAbi, type Address, type PublicClient } from "viem";
import { TOKENS } from "./registry.js";

/**
 * Fake tokens: a contract that calls itself USDG, NVDA or another token Heimdall knows, at a different address.
 * Robinhood's own docs say a token with a matching name or ticker at another address is not the real one.
 */
const NAMES: Record<string, string[]> = {
  USDG: ["Global Dollar", "Paxos Global Dollar"],
  WETH: ["Wrapped Ether"],
  NVDA: ["NVIDIA", "NVIDIA Corporation"],
  TSLA: ["Tesla", "Tesla Inc"],
  GOOGL: ["Alphabet", "Alphabet Inc", "Google"],
  AAPL: ["Apple", "Apple Inc"],
  MSFT: ["Microsoft", "Microsoft Corporation"],
  AMZN: ["Amazon", "Amazon.com", "Amazon.com Inc"],
  META: ["Meta Platforms", "Meta Platforms Inc", "Meta"],
  COIN: ["Coinbase", "Coinbase Global"],
  QQQ: ["Invesco QQQ", "Invesco QQQ Trust"],
  SPCX: ["SpaceX", "Space Exploration Technologies"],
  GME: ["GameStop", "GameStop Corp"],
  MU: ["Micron", "Micron Technology"],
  CRCL: ["Circle", "Circle Internet Group"],
  DELL: ["Dell", "Dell Technologies"],
  USO: ["United States Oil Fund", "US Oil Fund"],
  SGOV: ["iShares 0-3 Month Treasury Bond"],
};

// Letters from other scripts that render like Latin ones, the usual trick for a ticker that looks identical.
const CONFUSABLE: Record<string, string> = {
  "а": "a", "в": "b", "с": "c", "е": "e", "һ": "h", "і": "i", "ј": "j", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "т": "t", "у": "y", "х": "x", "ѕ": "s", "ԁ": "d", "ԛ": "q", "ԝ": "w",
  "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x",
  "Ａ": "a", "０": "o", "0": "o", "1": "l", "ı": "i", "ℓ": "l",
};

/** Lower-case, drop spaces, punctuation and zero-width characters, and fold look-alike letters to Latin. */
export function normalizeTicker(s: string): string {
  return [...s.normalize("NFKC").toLowerCase()]
    .map((ch) => CONFUSABLE[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]/g, "");
}

const PROTECTED: { address: string; symbol: string; keys: Set<string> }[] = Object.entries(TOKENS).map(([address, t]) => ({
  address,
  symbol: t.symbol,
  keys: new Set([t.symbol, ...(NAMES[t.symbol] ?? [])].map(normalizeTicker).filter((k) => k.length >= 3)),
}));

/** Which known token this one pretends to be, from its symbol and name; undefined for the real one or no match. */
export function impersonates(address: string, symbol?: string, name?: string): { symbol: string; real: string; by: "symbol" | "name" } | undefined {
  const a = address.toLowerCase();
  if (TOKENS[a]) return undefined;
  const sym = symbol && symbol !== "UNKNOWN" ? normalizeTicker(symbol) : "";
  const nm = name ? normalizeTicker(name) : "";
  for (const p of PROTECTED) {
    if (sym && p.keys.has(sym)) return { symbol: p.symbol, real: getAddress(p.address), by: "symbol" };
    if (nm && p.keys.has(nm)) return { symbol: p.symbol, real: getAddress(p.address), by: "name" };
  }
  return undefined;
}

const META = parseAbi(["function symbol() view returns (string)", "function name() view returns (string)"]);
// Per client, like the contract cache: a token's symbol and name do not change once deployed.
const caches = new WeakMap<PublicClient, Map<string, { symbol?: string; name?: string }>>();

export async function fakeTokenCheck(client: PublicClient, token: Address) {
  const k = token.toLowerCase();
  if (TOKENS[k]) return undefined;
  let cache = caches.get(client);
  if (!cache) caches.set(client, (cache = new Map()));
  let meta = cache.get(k);
  if (!meta) {
    const [symbol, name] = await Promise.all([
      client.readContract({ address: token, abi: META, functionName: "symbol" }).then(String).catch(() => undefined),
      client.readContract({ address: token, abi: META, functionName: "name" }).then(String).catch(() => undefined),
    ]);
    meta = { symbol, name };
    if (cache.size > 5_000) cache.delete(cache.keys().next().value!);
    cache.set(k, meta);
  }
  return impersonates(token, meta.symbol, meta.name);
}
