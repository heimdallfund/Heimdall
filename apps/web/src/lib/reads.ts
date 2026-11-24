import { cacheLife } from "next/cache";
import { createPublicClient, fallback, formatUnits, http, parseAbi, type Address } from "viem";
import { ADDRESSES, chain, HEIM_HOLDER_MIN, SHIELD_API_URL } from "./config";
import { heimAddress } from "./heim";
import { heimdallPayAbi, heimdallSignalsAbi, heimdallVaultAbi, heimdallVaultFactoryAbi } from "./abi";

// Server-side reads use the private RPC_URL (never sent to the browser) with RPC_URL_BACKUP and the public endpoint behind it.
const urls = [process.env.RPC_URL, process.env.RPC_URL_BACKUP, ...chain.rpcUrls.default.http].filter((u, i, a): u is string => !!u && a.indexOf(u) === i);
export const client = createPublicClient({ chain, transport: urls.length > 1 ? fallback(urls.map((u) => http(u, { timeout: 8_000, retryCount: 0 })), { retryCount: 1 }) : http(urls[0]) });
const ERC20 = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"]);

export interface VaultSummary {
  address: Address;
  name: string;
  symbol: string;
  manager: Address;
  nav: string | null; // USDG, formatted
  sharePrice: string | null; // USDG per share
  returnPct: number | null; // since inception (share price starts at 1.00)
  maxTradePct: number;
  maxLossPct: number;
  maxDailyLossPct: number;
  guardian: boolean; // manager holds at least HEIM_HOLDER_MIN $HEIM
}

export interface Position { token: Address; symbol: string; amount: string; value: string | null }

export interface SignalRow { id: number; provider: Address; payout: Address; price: string; active: boolean; meta: { name?: string; category?: string; description?: string; endpoint?: string } }

export async function readVault(address: Address): Promise<VaultSummary> {
  const r = <T,>(functionName: string, args: unknown[] = []) =>
    client.readContract({ address, abi: heimdallVaultAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
  const [name, symbol, manager, decimals, tradeBps, lossBps] = await Promise.all([
    r<string>("name"), r<string>("symbol"), r<Address>("manager"), r<number>("decimals"), r<number>("maxTradeBps"), r<number>("maxLossBps"),
  ]);
  const nav = await r<bigint>("totalAssets").catch(() => null);
  const dailyBps = await r<number>("maxDailyLossBps").catch(() => 500);
  const heim = ADDRESSES.heimHolder ?? (await heimAddress());
  const heimBal = heim ? await client.readContract({ address: heim, abi: ERC20, functionName: "balanceOf", args: [manager] }).catch(() => 0n) : 0n;
  const pps = await r<bigint>("convertToAssets", [10n ** BigInt(decimals)]).catch(() => null);
  return {
    address, name, symbol, manager,
    nav: nav === null ? null : formatUnits(nav, 6),
    sharePrice: pps === null ? null : formatUnits(pps, 6),
    returnPct: pps === null ? null : (Number(pps) / 1e6 - 1) * 100,
    maxTradePct: tradeBps / 100,
    maxLossPct: lossBps / 100,
    maxDailyLossPct: Number(dailyBps) / 100,
    guardian: heimBal >= HEIM_HOLDER_MIN,
  };
}

export async function listVaultAddresses(): Promise<Address[]> {
  if (!ADDRESSES.factory) return [];
  const count = await client.readContract({ address: ADDRESSES.factory, abi: heimdallVaultFactoryAbi, functionName: "vaultCount" });
  return Promise.all(Array.from({ length: Number(count) }, (_, i) =>
    client.readContract({ address: ADDRESSES.factory!, abi: heimdallVaultFactoryAbi, functionName: "allVaults", args: [BigInt(i)] })));
}

export async function getVaults(): Promise<VaultSummary[]> {
  "use cache";
  cacheLife("minutes");
  if (!ADDRESSES.factory) return [];
  try {
    const count = await client.readContract({ address: ADDRESSES.factory, abi: heimdallVaultFactoryAbi, functionName: "vaultCount" });
    const addrs = await Promise.all(Array.from({ length: Number(count) }, (_, i) =>
      client.readContract({ address: ADDRESSES.factory!, abi: heimdallVaultFactoryAbi, functionName: "allVaults", args: [BigInt(i)] })));
    return await Promise.all(addrs.map(readVault));
  } catch {
    return [];
  }
}

export async function getVault(address: Address): Promise<{ vault: VaultSummary; positions: Position[]; idle: string } | null> {
  "use cache";
  cacheLife("minutes");
  try {
    const vault = await readVault(address);
    const tracked = (await client.readContract({ address, abi: heimdallVaultAbi, functionName: "trackedAssets" })) as Address[];
    const usdgBal = await client.readContract({ address: ADDRESSES.usdg, abi: ERC20, functionName: "balanceOf", args: [address] });
    const positions: Position[] = [{ token: ADDRESSES.usdg, symbol: "USDG", amount: formatUnits(usdgBal, 6), value: formatUnits(usdgBal, 6) }];
    for (const token of tracked) {
      const [symbol, decimals, bal] = await Promise.all([
        client.readContract({ address: token, abi: ERC20, functionName: "symbol" }),
        client.readContract({ address: token, abi: ERC20, functionName: "decimals" }),
        client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [address] }),
      ]);
      const value = await client.readContract({ address, abi: heimdallVaultAbi, functionName: "valueOf", args: [token, bal] }).catch(() => null);
      positions.push({ token, symbol, amount: formatUnits(bal, decimals), value: value === null ? null : formatUnits(value as bigint, 6) });
    }
    return { vault, positions, idle: formatUnits(usdgBal, 6) };
  } catch {
    return null;
  }
}

export async function getSignals(): Promise<SignalRow[]> {
  "use cache";
  cacheLife("minutes");
  if (!ADDRESSES.signals) return [];
  try {
    const count = await client.readContract({ address: ADDRESSES.signals, abi: heimdallSignalsAbi, functionName: "signalCount" });
    const rows = await Promise.all(Array.from({ length: Number(count) }, (_, i) =>
      client.readContract({ address: ADDRESSES.signals!, abi: heimdallSignalsAbi, functionName: "getSignal", args: [BigInt(i)] })));
    return rows.map((s, id) => {
      let meta: SignalRow["meta"] = {};
      try { meta = JSON.parse(s.uri); } catch { meta = { name: s.uri }; }
      return { id, provider: s.provider, payout: s.payout, price: formatUnits(s.pricePerCall, 6), active: s.active, meta };
    });
  } catch {
    return [];
  }
}

export interface ShieldStats { checks: number; allowed: number; warned: number; denied: number; since: string }

export async function getShieldStats(): Promise<ShieldStats | null> {
  "use cache";
  cacheLife("seconds");
  try {
    const res = await fetch(`${SHIELD_API_URL}/v1/stats`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    return (await res.json()) as ShieldStats;
  } catch {
    return null;
  }
}

/** $HEIM balance check for profile badges (false when $HEIM is not live yet). */
export async function isHeimHolder(address: Address): Promise<boolean> {
  "use cache";
  cacheLife("minutes");
  const heim = ADDRESSES.heimHolder ?? (await heimAddress());
  if (!heim) return false;
  const bal = await client.readContract({ address: heim, abi: ERC20, functionName: "balanceOf", args: [address] }).catch(() => 0n);
  return bal >= HEIM_HOLDER_MIN;
}

/** Heimdall Pay track record of a provider (zeros when Pay is not deployed yet). */
export async function payRecord(provider: Address): Promise<{ completed: bigint; disputed: bigint; earned: bigint } | null> {
  if (!ADDRESSES.pay) return null;
  const read = (fn: "completedOf" | "disputedOf" | "earnedOf") =>
    client.readContract({ address: ADDRESSES.pay!, abi: heimdallPayAbi, functionName: fn, args: [provider] }) as Promise<bigint>;
  try {
    const [completed, disputed, earned] = await Promise.all([read("completedOf"), read("disputedOf"), read("earnedOf")]);
    return { completed, disputed, earned };
  } catch { return null; }
}
