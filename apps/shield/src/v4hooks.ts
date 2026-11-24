import { getAddress, type Address, type PublicClient } from "viem";
import { isBlocklisted } from "./blocklist.js";
import type { Finding } from "./types.js";

/**
 * Uniswap v4 hooks. A v4 pool can name a hook contract that runs around every swap. What it may do is written in
 * the last 14 bits of its address, so the permissions can be read without calling it:
 *   bit 7 beforeSwap, bit 6 afterSwap (can revert, so can block sells), bit 3 beforeSwapReturnsDelta and
 *   bit 2 afterSwapReturnsDelta (can change what you pay or receive: a hidden fee of any size).
 * A pool whose fee is the dynamic-fee flag lets the hook set the swap fee at swap time.
 */
export const POOL_MANAGER: Address = getAddress("0x8366a39cc670b4001a1121b8f6a443a643e40951");
export const POSITION_MANAGER: Address = getAddress("0x58daec3116aae6d93017baaea7749052e8a04fa7");
export const UNIVERSAL_ROUTER: Address = getAddress("0x8876789976decbfcbbbe364623c63652db8c0904");
export const DYNAMIC_FEE = 0x800000;

const FLAGS: [number, string][] = [
  [13, "beforeInitialize"], [12, "afterInitialize"], [11, "beforeAddLiquidity"], [10, "afterAddLiquidity"],
  [9, "beforeRemoveLiquidity"], [8, "afterRemoveLiquidity"], [7, "beforeSwap"], [6, "afterSwap"],
  [5, "beforeDonate"], [4, "afterDonate"], [3, "beforeSwapReturnsDelta"], [2, "afterSwapReturnsDelta"],
  [1, "afterAddLiquidityReturnsDelta"], [0, "afterRemoveLiquidityReturnsDelta"],
];

export function hookPermissions(hook: string): string[] {
  const low = Number(BigInt(hook) & 0x3fffn);
  return FLAGS.filter(([bit]) => (low >> bit) & 1).map(([, name]) => name);
}

export interface PoolKeyLite { currency0: string; currency1: string; fee: number; hooks: string }

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Findings for the hooks of the v4 pools a swap goes through. Plain pools (no hook) produce nothing. */
export async function assessHooks(client: PublicClient, pools: PoolKeyLite[]): Promise<Finding[]> {
  const F: Finding[] = [];
  const seen = new Set<string>();
  for (const p of pools) {
    if (p.fee === DYNAMIC_FEE && !seen.has(`fee:${p.hooks}`)) {
      seen.add(`fee:${p.hooks}`);
      F.push({ code: "HOOK_DYNAMIC_FEE", severity: "warn", message: `This Uniswap v4 pool lets its hook ${short(p.hooks)} set the swap fee at swap time, so the fee you pay is not fixed.` });
    }
    if (/^0x0{40}$/i.test(p.hooks) || seen.has(p.hooks.toLowerCase())) continue;
    seen.add(p.hooks.toLowerCase());
    if (isBlocklisted(p.hooks)) { F.push({ code: "BLOCKLISTED_HOOK", severity: "deny", message: `The Uniswap v4 pool uses hook ${short(p.hooks)}, which is on the Heimdall blocklist.` }); continue; }
    const code = await client.getCode({ address: p.hooks as Address }).catch(() => undefined);
    if (!code || code === "0x") { F.push({ code: "HOOK_NO_CODE", severity: "deny", message: `The Uniswap v4 pool names hook ${short(p.hooks)}, but there is no contract there.` }); continue; }
    const perms = hookPermissions(p.hooks);
    if (perms.includes("beforeSwapReturnsDelta") || perms.includes("afterSwapReturnsDelta")) {
      F.push({ code: "HOOK_TAKES_DELTA", severity: "warn", message: `The Uniswap v4 pool's hook ${short(p.hooks)} can change the amounts of every swap: it can charge a hidden fee of any size. The simulated amounts above are what it took this time.` });
    } else if (perms.includes("beforeSwap") || perms.includes("afterSwap")) {
      F.push({ code: "HOOK_ON_SWAP", severity: "info", message: `The Uniswap v4 pool's hook ${short(p.hooks)} runs on every swap and could refuse later trades, for example sells.` });
    }
  }
  return F;
}
