import { createPublicClient, formatUnits, getAddress, http, parseAbi, type Address } from "viem";
import { ADDRESSES } from "./config";
import { client } from "./reads";

// wide log queries go to the public endpoint: it serves 10M blocks per query on one address
const logs = createPublicClient({ transport: http(process.env.LOGS_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", { timeout: 15_000, retryCount: 1 }) });
const STAKED = "0x9e71bc8eea02a63969f509818f2dafb9254532904319f9dbda79b67bd34a5f3d"; // Staked(address indexed user, uint256 amount)
const WITHDRAWN = "0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5"; // Withdrawn(address indexed user, uint256 amount)
const DEPLOY_BLOCK = process.env.NEXT_PUBLIC_DEPLOY_BLOCK ? BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK) : 0n;
const ABI = parseAbi(["function totalStaked() view returns (uint256)", "function rewardPerDay() view returns (uint256)"]);

export interface Staker { address: Address; staked: number; share: number; usdgPerWeek: number | null }
export interface StakerBoard { stakers: Staker[]; count: number; total: number; usdgPerDay: number }

/** Every $HEIM staker and their stake, rebuilt from the staking contract's Staked and Withdrawn events. */
export async function readStakers(limit = 10): Promise<StakerBoard | null> {
  const staking = ADDRESSES.staking;
  if (!staking) return null;
  const latest = await logs.getBlockNumber();
  const floor = latest > 9_900_000n ? latest - 9_900_000n : 0n;
  const from = DEPLOY_BLOCK > floor ? DEPLOY_BLOCK : floor;
  const [found, total, perDay] = await Promise.all([
    logs.request({ method: "eth_getLogs", params: [{ address: staking, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${latest.toString(16)}`, topics: [[STAKED, WITHDRAWN]] }] }) as Promise<{ topics: `0x${string}`[]; data: `0x${string}` }[]>,
    client.readContract({ address: staking, abi: ABI, functionName: "totalStaked" }),
    client.readContract({ address: staking, abi: ABI, functionName: "rewardPerDay" }).catch(() => 0n),
  ]);
  const bal = new Map<string, bigint>();
  for (const l of found) {
    const who = getAddress(`0x${l.topics[1]!.slice(26)}`);
    const amt = BigInt(l.data.slice(0, 66));
    bal.set(who, (bal.get(who) ?? 0n) + (l.topics[0] === STAKED ? amt : -amt));
  }
  const live = [...bal.entries()].filter(([, v]) => v > 0n).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
  const totalN = Number(formatUnits(total, 18));
  const perDayN = Number(formatUnits(perDay, 6));
  return {
    count: live.length, total: totalN, usdgPerDay: perDayN,
    stakers: live.slice(0, limit).map(([a, v]) => {
      const staked = Number(formatUnits(v, 18));
      const share = totalN > 0 ? staked / totalN : 0;
      return { address: a as Address, staked, share, usdgPerWeek: perDayN > 0 ? perDayN * 7 * share : null };
    }),
  };
}
