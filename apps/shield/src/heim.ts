import { getAddress, pad, parseAbi, type Address, type PublicClient } from "viem";
import type { CounterStore } from "./store.js";

/**
 * $HEIM's address, found on its own when it launches on Pons, so holder benefits switch on without a redeploy.
 * Only a Pons launch created by the Heimdall dev wallet, whose token names that wallet as deployer and whose ticker is
 * HEIM, counts: a copycat from another wallet, or another token from the dev wallet, is never picked up.
 */
export const HEIM_DEV: Address = "0x6446eA9501a973C38b3760fA51f55D78BbB41CBC";
const PONS_FACTORY: Address = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const LAUNCHED = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
/** Earlier $HEIM launches that were retired (the first one, 2026-11-24): never picked up again. */
export const RETIRED_HEIM = new Set(["0x6e446368fd41f18edb48a8a55766802e0713bcbc"]);
const TOKEN = parseAbi(["function deployer() view returns (address)", "function symbol() view returns (string)"]);

export async function findHeimLaunch(client: PublicClient, logs: PublicClient): Promise<Address | null> {
  const latest = await logs.getBlockNumber();
  const from = latest > 9_900_000n ? latest - 9_900_000n : 0n; // one address: the public RPC serves 10M blocks per query
  const found = await logs.request({
    method: "eth_getLogs",
    params: [{ address: PONS_FACTORY, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${latest.toString(16)}`, topics: [LAUNCHED, null, null, pad(HEIM_DEV)] }],
  } as never) as { topics: `0x${string}`[] }[];
  // newest first: a relaunch replaces the one before it
  for (const l of [...found].reverse()) {
    const token = getAddress(`0x${l.topics[1]!.slice(26)}`);
    if (RETIRED_HEIM.has(token.toLowerCase())) continue;
    const [deployer, symbol] = await Promise.all([
      client.readContract({ address: token, abi: TOKEN, functionName: "deployer" }).catch(() => null),
      client.readContract({ address: token, abi: TOKEN, functionName: "symbol" }).catch(() => ""),
    ]);
    if (deployer && getAddress(deployer) === HEIM_DEV && symbol.replace(/^\$/, "").toUpperCase() === "HEIM") return token;
  }
  return null;
}

/** The env address if set, else the one found (kept for good once found), else a fresh look at most once a minute. */
export async function heimToken(store: CounterStore, client: PublicClient, logs: PublicClient, envAddress?: string): Promise<Address | null> {
  if (envAddress) return getAddress(envAddress);
  const known = await store.fetch("heim:token:v2").catch(() => null);
  if (known) return getAddress(known);
  if ((await store.incr("heim:lookup:v2", 60).catch(() => 2)) !== 1) return null;
  const found = await findHeimLaunch(client, logs).catch(() => null);
  if (found) await store.put("heim:token:v2", found).catch(() => {});
  return found;
}
