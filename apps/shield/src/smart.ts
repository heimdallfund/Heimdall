import { getAddress, parseAbi, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import type { CounterStore } from "./store.js";
import { POOL_MANAGER, UNIVERSAL_ROUTER } from "./v4hooks.js";

/**
 * "Smart money", defined narrowly and from the chain only: a wallet that was among the first 30 buyers of at least
 * two Pons tokens that later graduated to Uniswap. Built a few tokens at a time from graduations seen in the last day.
 * It says nothing about profit; it says the wallet has been early to tokens that went on to fill their curve.
 */

const PONS_FACTORY: Address = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const PONS_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";
const LAUNCH = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const INIT = parseAbiItem("event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)");
const CURVE = parseAbi(["function curve() view returns (address)"]);
const TTL = 30 * 86_400;
const EARLY = 30;
const SKIP = new Set([POOL_MANAGER.toLowerCase(), UNIVERSAL_ROUTER.toLowerCase(), "0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);
const topic = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}` as Hex;

/** The first buyers from a Pons token's curve, in order. */
export async function earlyBuyers(client: PublicClient, logs: PublicClient, token: Address, max = EARLY): Promise<string[]> {
  const curve = await client.readContract({ address: token, abi: CURVE, functionName: "curve" }).catch(() => null);
  if (!curve) return [];
  const head = await logs.getBlockNumber();
  const from = head > 9_900_000n ? head - 9_900_000n : 0n;
  const launch = await logs.request({ method: "eth_getLogs", params: [{ address: PONS_FACTORY, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${head.toString(16)}`, topics: [LAUNCH, topic(token)] }] } as never) as { blockNumber: Hex }[];
  const start = launch[0] ? BigInt(launch[0].blockNumber) : from;
  // the first ~3 hours of trading are enough to find the first buyers
  const end = start + 100_000n < head ? start + 100_000n : head;
  const out = await logs.request({ method: "eth_getLogs", params: [{ address: token, topics: [TRANSFER, topic(curve)], fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` }] } as never) as { topics: Hex[] }[];
  const buyers: string[] = [];
  for (const l of out) {
    const to = `0x${l.topics[2]!.slice(26)}`.toLowerCase();
    if (SKIP.has(to) || to === curve.toLowerCase() || buyers.includes(to)) continue;
    buyers.push(to);
    if (buyers.length >= max) break;
  }
  return buyers;
}

/** Learns from Pons tokens that graduated in the last day (a few per call). Returns how many tokens it learned from. */
export async function learnSmartMoney(store: CounterStore, client: PublicClient, logs: PublicClient, maxTokens = 4): Promise<number> {
  const head = await logs.getBlockNumber();
  const inits = await logs.getLogs({ address: POOL_MANAGER, event: INIT, fromBlock: head - 820_000n, toBlock: head }).catch(() => []);
  const graduated = [...new Set(inits.filter((l) => l.args.hooks!.toLowerCase() === PONS_HOOK)
    .map((l) => (/^0x0{40}$/i.test(l.args.currency0!) ? l.args.currency1! : l.args.currency0!).toLowerCase()))];
  let learned = 0;
  for (const t of graduated) {
    if (learned >= maxTokens) break;
    if (await store.fetch(`smart:done:${t}`)) continue;
    const buyers = await earlyBuyers(client, logs, getAddress(t)).catch(() => null);
    if (!buyers) continue;
    for (const b of buyers) if ((await store.incr(`smart:w:${b}`, TTL)) >= 2) await store.addMember("smart:wallets", b);
    await store.put(`smart:done:${t}`, "1", TTL);
    learned++;
  }
  return learned;
}

let cache: { at: number; set: Set<string> } | null = null;
/** How many of these wallets are smart money (cached for five minutes). */
export async function smartCount(store: CounterStore, wallets: string[]): Promise<number> {
  if (!cache || Date.now() - cache.at > 300_000) cache = { at: Date.now(), set: new Set(await store.members("smart:wallets")) };
  return wallets.filter((w) => cache!.set.has(w.toLowerCase())).length;
}
