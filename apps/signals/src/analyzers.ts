import { type Address, type Hex, type PublicClient, formatUnits, getAddress, parseAbi } from "viem";

const ERC20 = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function owner() view returns (address)",
]);

// EIP-1967 storage slots
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

/** 4-byte selectors that give an owner power over holders. */
const POWER_SELECTORS: Record<string, string> = {
  "40c10f19": "mint(address,uint256)",
  "8456cb59": "pause()",
  "f9f92be4": "blacklist(address)",
  "44337ea1": "addToBlacklist(address)",
  "69fe0e2d": "setFee(uint256)",
  "8f02bb5b": "setTransferFeeRate / setFees",
  "c0246668": "excludeFromFees(address,bool)",
  "e01af92c": "setSwapEnabled / tradingOpen",
};

export const CANONICAL: Record<string, string> = {
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168": "USDG",
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73": "WETH",
};

const slotAddress = (v?: Hex | null): Address | null => {
  if (!v || BigInt(v) === 0n) return null;
  return getAddress(`0x${v.slice(-40)}`);
};

export interface TokenRisk {
  token: Address;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  canonical: boolean;
  bytecodeSize: number;
  upgradeable: boolean;
  implementation: Address | null;
  owner: Address | null;
  ownerRenounced: boolean | null;
  ownerPowers: string[];
  score: number; // 0 = safest, 100 = most dangerous
  level: "low" | "medium" | "high" | "critical";
  reasons: string[];
}

export async function tokenRisk(client: PublicClient, token: Address, blocklist: Set<string>): Promise<TokenRisk> {
  const lc = token.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  const code = (await client.getCode({ address: token }).catch(() => undefined)) ?? "0x";
  const bytecodeSize = (code.length - 2) / 2;
  if (bytecodeSize === 0) {
    return { token, symbol: null, decimals: null, totalSupply: null, canonical: false, bytecodeSize, upgradeable: false, implementation: null, owner: null, ownerRenounced: null, ownerPowers: [], score: 100, level: "critical", reasons: ["Not a contract: no token lives at this address."] };
  }
  const read = <T,>(functionName: "symbol" | "decimals" | "totalSupply" | "owner") =>
    client.readContract({ address: token, abi: ERC20, functionName }).then((v) => v as T).catch(() => null);
  const [symbol, decimals, supply, owner, implSlot, adminSlot] = await Promise.all([
    read<string>("symbol"), read<number>("decimals"), read<bigint>("totalSupply"), read<Address>("owner"),
    client.getStorageAt({ address: token, slot: IMPL_SLOT }).catch(() => null),
    client.getStorageAt({ address: token, slot: ADMIN_SLOT }).catch(() => null),
  ]);
  const canonical = lc in CANONICAL;
  const implementation = slotAddress(implSlot);
  const upgradeable = !!implementation || !!slotAddress(adminSlot);
  const ownerRenounced = owner === null ? null : BigInt(owner) === 0n;

  // owner powers are read from the runtime code (and the implementation's, for proxies)
  let scanCode = code.toLowerCase();
  if (implementation) scanCode += ((await client.getCode({ address: implementation }).catch(() => undefined)) ?? "").toLowerCase();
  const ownerPowers = Object.entries(POWER_SELECTORS)
    .filter(([sel, name]) => name && scanCode.includes(`63${sel}`)) // PUSH4 <selector>
    .map(([, name]) => name);

  if (blocklist.has(lc)) { score += 100; reasons.push("On the Heimdall blocklist."); }
  if (canonical) reasons.push(`Canonical ${CANONICAL[lc]} listed in the Robinhood Chain docs.`);
  if (symbol === null || decimals === null) { score += 30; reasons.push("Does not answer symbol()/decimals(): not a standard ERC-20."); }
  if (upgradeable && !canonical) { score += 20; reasons.push("Upgradeable proxy: its code can be replaced."); }
  if (!canonical && ownerRenounced === false && ownerPowers.length) {
    score += 15 + 10 * ownerPowers.length;
    reasons.push(`Owner ${owner} can call ${ownerPowers.join(", ")}.`);
  } else if (ownerRenounced) reasons.push("Ownership renounced.");
  if (canonical) score = Math.min(score, 10);
  score = Math.max(0, Math.min(100, score));
  const level = score >= 80 ? "critical" : score >= 50 ? "high" : score >= 20 ? "medium" : "low";
  return {
    token, symbol, decimals, totalSupply: supply !== null && decimals !== null ? formatUnits(supply, decimals) : null,
    canonical, bytecodeSize, upgradeable, implementation, owner, ownerRenounced, ownerPowers, score, level, reasons,
  };
}

export interface AddressIntel {
  address: Address;
  kind: "eoa" | "contract" | "delegated-eoa";
  delegatesTo: Address | null;
  transactions: number;
  ethBalance: string;
  usdgBalance: string;
  blocklisted: boolean;
  notes: string[];
}

export async function addressIntel(client: PublicClient, address: Address, usdg: Address, blocklist: Set<string>): Promise<AddressIntel> {
  const [code, nonce, eth, usd] = await Promise.all([
    client.getCode({ address }).catch(() => undefined),
    client.getTransactionCount({ address }).catch(() => 0),
    client.getBalance({ address }).catch(() => 0n),
    client.readContract({ address: usdg, abi: ERC20, functionName: "balanceOf", args: [address] }).catch(() => 0n),
  ]);
  const c = (code ?? "0x").toLowerCase();
  const delegated = c.startsWith("0xef0100");
  const kind = !code || code === "0x" ? "eoa" : delegated ? "delegated-eoa" : "contract";
  const blocklisted = blocklist.has(address.toLowerCase());
  const notes: string[] = [];
  if (blocklisted) notes.push("On the Heimdall blocklist.");
  if (kind === "eoa" && nonce === 0) notes.push("Fresh wallet: no transactions sent yet.");
  if (delegated) notes.push("EIP-7702 delegated account: its code can run on the owner's behalf.");
  return {
    address, kind, delegatesTo: delegated ? getAddress(`0x${c.slice(8, 48)}`) : null, transactions: nonce,
    ethBalance: formatUnits(eth, 18), usdgBalance: formatUnits(usd as bigint, 6), blocklisted, notes,
  };
}

// ───────────────────────────── Stock token premium ─────────────────────────────

const POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

export interface StockSource { pool: Address; token: Address; quoteDecimals: number; tokenDecimals: number }

/** Price of `token` in the quote asset from a Uniswap v3-style pool. */
export async function poolPrice(client: PublicClient, s: StockSource): Promise<number> {
  const [[sqrtPriceX96], token0] = await Promise.all([
    client.readContract({ address: s.pool, abi: POOL_ABI, functionName: "slot0" }),
    client.readContract({ address: s.pool, abi: POOL_ABI, functionName: "token0" }),
  ]);
  const p = Number(sqrtPriceX96) / 2 ** 96;
  const raw = p * p; // token1 per token0 in base units
  const tokenIs0 = token0.toLowerCase() === s.token.toLowerCase();
  const adj = tokenIs0 ? raw * 10 ** (s.tokenDecimals - s.quoteDecimals) : (1 / raw) * 10 ** (s.tokenDecimals - s.quoteDecimals);
  return adj;
}

/** Reference (exchange) price from a configurable HTTP source: URL template with {symbol}, numeric field path. */
export async function referencePrice(urlTemplate: string, jsonPath: string, symbol: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  const res = await fetchImpl(urlTemplate.replace("{symbol}", encodeURIComponent(symbol)), { signal: AbortSignal.timeout(4_000) });
  if (!res.ok) throw new Error(`reference source ${res.status}`);
  let v: unknown = await res.json();
  for (const k of jsonPath.split(".").filter(Boolean)) v = (v as Record<string, unknown>)?.[k];
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error("reference price missing");
  return n;
}
