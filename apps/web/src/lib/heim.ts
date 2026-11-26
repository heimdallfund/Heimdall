import { createPublicClient, getAddress, http, pad, parseAbi, type Address } from "viem";
import { ADDRESSES } from "./config";
import { kv } from "./kv";
import { client } from "./reads";

/**
 * $HEIM's contract address, found on its own when the token launches on Pons.
 * Order: NEXT_PUBLIC_HEIM_ADDRESS if set; the address already found (kept in KV); otherwise a look at the Pons factory's
 * launch events for one created by the Heimdall dev wallet, at most once a minute. A token only counts if the Pons
 * token itself names the dev wallet as its deployer and its ticker is HEIM, so a copycat launch from another wallet,
 * or a different token from the dev wallet, is never picked up.
 */
export const HEIM_DEV: Address = "0x6446eA9501a973C38b3760fA51f55D78BbB41CBC";
const PONS_FACTORY: Address = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
/** Pons launch event: topics = [sig, token, curve, creator]. */
const LAUNCHED = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607" as const;
const TOKEN = parseAbi(["function deployer() view returns (address)", "function symbol() view returns (string)"]);
// v2: the first $HEIM (launched 2026-11-24) was retired for a relaunch; the old key still holds its address
const KEY = "heim:token:v2";
/** Earlier $HEIM launches that were retired: never picked up again, even though they match the dev wallet and ticker. */
export const RETIRED_HEIM = new Set(["0x6e446368fd41f18edb48a8a55766802e0713bcbc"]);
// wide log queries go to the public endpoint: it serves 10M blocks per query on one address, paid RPC plans do not
const logs = createPublicClient({ transport: http(process.env.LOGS_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", { timeout: 15_000, retryCount: 1 }) });
const CHECKED = "heim:checkedAt:v2";

export async function findHeimLaunch(): Promise<Address | null> {
  const latest = await logs.getBlockNumber();
  const from = latest > 9_900_000n ? latest - 9_900_000n : 0n;
  const found = await logs.request({
    method: "eth_getLogs",
    params: [{ address: PONS_FACTORY, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${latest.toString(16)}`, topics: [LAUNCHED, null, null, pad(HEIM_DEV)] }],
  }) as { topics: `0x${string}`[] }[];
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

export async function heimAddress(): Promise<Address | undefined> {
  if (ADDRESSES.heim) return ADDRESSES.heim;
  try {
    const known = await kv.get(KEY);
    if (known) return getAddress(known);
    const last = Number(await kv.get(CHECKED)) || 0;
    if (Date.now() - last < 60_000) return undefined;
    await kv.set(CHECKED, String(Date.now()));
    const found = await findHeimLaunch();
    if (found) await kv.set(KEY, found);
    return found ?? undefined;
  } catch {
    return undefined;
  }
}
