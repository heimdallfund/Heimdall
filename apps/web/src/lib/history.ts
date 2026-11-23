import { cacheLife } from "next/cache";
import { type Address, type Hex } from "viem";
import { kv } from "./kv";
import { client, listVaultAddresses, readVault } from "./reads";
import { heimdallVaultAbi } from "./abi";

export interface NavPoint { t: number; pps: number; nav: number }
const KEEP = 3000; // 15-minute points ≈ 31 days

/** Cron: append one NAV / share-price point per vault. */
export async function snapshotAll(): Promise<{ vault: Address; pps: number | null }[]> {
  const out: { vault: Address; pps: number | null }[] = [];
  for (const vault of await listVaultAddresses()) {
    const v = await readVault(vault).catch(() => null);
    if (!v || v.sharePrice === null || v.nav === null) { out.push({ vault, pps: null }); continue; }
    const p: NavPoint = { t: Date.now(), pps: Number(v.sharePrice), nav: Number(v.nav) };
    await kv.push(`nav:${vault.toLowerCase()}`, JSON.stringify(p), KEEP);
    await creationBlock(vault); // warm the cache used by the decision log
    out.push({ vault, pps: p.pps });
  }
  return out;
}

export async function getHistory(vault: Address): Promise<NavPoint[]> {
  "use cache";
  cacheLife("minutes");
  try {
    return (await kv.range(`nav:${vault.toLowerCase()}`)).map((s) => JSON.parse(s) as NavPoint);
  } catch {
    return [];
  }
}

/** Return over the last `days`, from the first snapshot at or after the window start. Null if not enough history. */
export function windowReturn(points: NavPoint[], days: number): number | null {
  if (points.length < 2) return null;
  const now = points.at(-1)!.t; // measured up to the latest snapshot
  const from = now - days * 86_400_000;
  const start = points.find((p) => p.t >= from);
  const end = points.at(-1)!;
  if (!start || start === end || end.t - start.t < days * 86_400_000 * 0.8) return null;
  return (end.pps / start.pps - 1) * 100;
}

/** First block where the vault has code (binary search once, then cached). */
export async function creationBlock(vault: Address): Promise<bigint> {
  const key = `vaultBlock:${vault.toLowerCase()}`;
  const cached = await kv.get(key).catch(() => null);
  if (cached) return BigInt(cached);
  let lo = 0n;
  let hi = await client.getBlockNumber();
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const code = await client.getCode({ address: vault, blockNumber: mid }).catch(() => undefined);
    if (code && code !== "0x") hi = mid; else lo = mid + 1n;
  }
  await kv.set(key, lo.toString()).catch(() => {});
  return lo;
}

const SELECTORS: Record<string, string> = {
  "0x095ea7b3": "approve", "0x04e45aaf": "swap (Uniswap v3)", "0x414bf389": "swap (Uniswap v3)", "0x3593564c": "swap (Universal Router)",
  "0xac9650d8": "multicall", "0x5ae401dc": "multicall", "0xd0e30db0": "wrap ETH", "0x2e1a7d4d": "unwrap WETH", "0xdb3e2198": "swap",
};

export interface Decision { tx: Hex; block: string; time: number; target: Address; action: string; checkId: Hex; navBefore: number; navAfter: number }

export async function getDecisions(vault: Address, limit = 20): Promise<Decision[]> {
  "use cache";
  cacheLife("minutes");
  try {
    const fromBlock = await creationBlock(vault);
    const logs = await client.getContractEvents({ address: vault, abi: heimdallVaultAbi, eventName: "Executed", fromBlock, toBlock: "latest" });
    const last = logs.slice(-limit).reverse();
    const blocks = new Map<bigint, number>();
    for (const l of last) {
      if (!blocks.has(l.blockNumber)) blocks.set(l.blockNumber, Number((await client.getBlock({ blockNumber: l.blockNumber })).timestamp) * 1000);
    }
    return last.map((l) => {
      const a = l.args as { target: Address; selector: Hex; checkId: Hex; navBefore: bigint; navAfter: bigint };
      return {
        tx: l.transactionHash, block: l.blockNumber.toString(), time: blocks.get(l.blockNumber)!, target: a.target,
        action: SELECTORS[a.selector.toLowerCase()] ?? a.selector, checkId: a.checkId,
        navBefore: Number(a.navBefore) / 1e6, navAfter: Number(a.navAfter) / 1e6,
      };
    });
  } catch {
    return [];
  }
}
