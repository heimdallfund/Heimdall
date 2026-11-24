import { getAddress, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import type { Finding } from "./types.js";

/**
 * What happened to a dev's earlier launches on Pons, read from the chain: for each of their recent tokens, whether
 * it graduated, whether the dev sold most of what they got, or whether it died on the curve. A dev who launched
 * and dumped several tokens is the strongest single warning a memecoin can carry.
 */
export type Outcome = "graduated" | "dumped" | "dead" | "active";
export interface DevHistory {
  launchpad: string;
  /** Other launches by this dev on the same launchpad in about the last month. */
  launches: number;
  /** How many of them were looked at (the most recent first). */
  checked: number;
  graduated: number;
  dumped: number;
  dead: number;
  active: number;
  recent: { token: Address; symbol: string | null; outcome: Outcome }[];
}

const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const LAUNCH = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ABI = parseAbi(["function graduated() view returns (bool)", "function getReserves() view returns (uint256, uint256)", "function graduationThreshold() view returns (uint256)", "function symbol() view returns (string)"]);
const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);
const topic = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
const DAY_BLOCKS = 820_000n;

export async function ponsDevHistory(client: PublicClient, logs: PublicClient, dev: Address, exclude: Address, max = 10): Promise<DevHistory | null> {
  const head = await logs.getBlockNumber();
  const from = head > 9_900_000n ? head - 9_900_000n : 0n;
  const launches = await logs.request({ method: "eth_getLogs", params: [{ address: PONS_FACTORY, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${head.toString(16)}`, topics: [LAUNCH, null, null, topic(dev)] }] } as never) as { topics: Hex[]; blockNumber: Hex }[];
  const others = launches.map((l) => ({ token: getAddress(`0x${l.topics[1]!.slice(26)}`), curve: getAddress(`0x${l.topics[2]!.slice(26)}`), block: BigInt(l.blockNumber) }))
    .filter((l) => l.token.toLowerCase() !== exclude.toLowerCase())
    .sort((a, b) => Number(b.block - a.block));
  if (!others.length) return { launchpad: "Pons", launches: 0, checked: 0, graduated: 0, dumped: 0, dead: 0, active: 0, recent: [] };
  const look = others.slice(0, max);
  const devT = topic(dev);
  const r = <T>(address: Address, functionName: string) => client.readContract({ address, abi: ABI, functionName: functionName as never }).then((v) => v as T).catch(() => null);
  const results = await Promise.all(look.map(async (l) => {
    const range = { fromBlock: `0x${l.block.toString(16)}`, toBlock: `0x${head.toString(16)}` };
    const [graduated, reserves, threshold, symbol, outs, ins] = await Promise.all([
      r<boolean>(l.curve, "graduated"), r<readonly [bigint, bigint]>(l.curve, "getReserves"), r<bigint>(l.curve, "graduationThreshold"), r<string>(l.token, "symbol"),
      logs.request({ method: "eth_getLogs", params: [{ address: l.token, topics: [TRANSFER, devT], ...range }] } as never).catch(() => null) as Promise<{ topics: Hex[]; data: Hex }[] | null>,
      logs.request({ method: "eth_getLogs", params: [{ address: l.token, topics: [TRANSFER, null, devT], ...range }] } as never).catch(() => null) as Promise<{ topics: Hex[]; data: Hex }[] | null>,
    ]);
    const sum = (ls: { topics: Hex[]; data: Hex }[] | null, skipBurn: boolean) => (ls ?? []).filter((x) => !skipBurn || !BURN.has(`0x${x.topics[2]!.slice(26)}`)).reduce((a, x) => a + BigInt(x.data.slice(0, 66)), 0n);
    const got = sum(ins, false), sent = sum(outs, true);
    const soldPct = got > 0n ? Number((sent * 100n) / got) : null;
    const progress = reserves && threshold && threshold > 0n ? Number((reserves[0] * 100n) / threshold) : null;
    const outcome: Outcome = graduated ? "graduated"
      : soldPct !== null && soldPct >= 50 ? "dumped"
      : head - l.block > DAY_BLOCKS && progress !== null && progress < 10 ? "dead"
      : "active";
    return { token: l.token, symbol: symbol?.slice(0, 20) ?? null, outcome };
  }));
  const count = (o: Outcome) => results.filter((x) => x.outcome === o).length;
  return { launchpad: "Pons", launches: others.length, checked: results.length, graduated: count("graduated"), dumped: count("dumped"), dead: count("dead"), active: count("active"), recent: results.slice(0, 5) };
}

export function devHistoryFindings(h: DevHistory): Finding[] {
  const F: Finding[] = [];
  if (!h.launches) return F;
  const parts = [h.dumped && `${h.dumped} dumped by the dev`, h.dead && `${h.dead} ${h.launchpad === "Pons" || !h.launchpad ? "died on the curve" : "went quiet (no trades in a day)"}`, h.graduated && `${h.graduated} graduated`, h.active && `${h.active} still trading`].filter(Boolean).join(", ");
  const of = h.checked < h.launches ? ` (the ${h.checked} most recent of ${h.launches})` : "";
  const msg = `This dev launched ${h.launches} other token${h.launches === 1 ? "" : "s"} on ${h.launchpad ?? "Pons"} in about the last month${of}: ${parts}.`;
  if (h.dumped >= 5 || (h.dumped >= 3 && h.dumped / h.checked >= 0.6)) F.push({ code: "SERIAL_DUMPER", severity: h.dumped >= 5 ? "deny" : "warn", message: `${msg} A dev who sold out of most earlier launches is likely to do it again.` });
  else if (h.dumped >= 1 || h.launches >= 5) F.push({ code: "DEV_HISTORY", severity: "warn", message: msg });
  else F.push({ code: "DEV_HISTORY", severity: "info", message: msg });
  return F;
}

// ---- Klik: launches are logged by the launchpad (the token in the event data) and the deployer is stored onchain

const KLIK: Address = "0x16cF6788B762EE8969744586eD16fc5705140dd7";
const KLIK_LAUNCH = "0x60122e78030aba0a2e4a67adb3e52b411343cc51778f919095d3fe394090c1b2";
const KLIK_INFO = parseAbi(["function tokenInfoByAddress(address) view returns (address tokenAddress, string name, string symbol, address deployer, uint256 time, string metadata, uint256 marketCapInETH, uint256 totalFeesGenerated)"]);
let klikIndex: { at: number; rows: { token: Address; deployer: string; symbol: string; block: bigint }[] } | null = null;

/** Every Klik launch in about the last month with its deployer, cached for ten minutes. */
async function klikLaunches(client: PublicClient, logs: PublicClient) {
  if (klikIndex && Date.now() - klikIndex.at < 600_000) return klikIndex.rows;
  const head = await logs.getBlockNumber();
  const from = head > 9_900_000n ? head - 9_900_000n : 0n;
  const ev = await logs.request({ method: "eth_getLogs", params: [{ address: KLIK, topics: [KLIK_LAUNCH], fromBlock: `0x${from.toString(16)}`, toBlock: `0x${head.toString(16)}` }] } as never) as { data: Hex; blockNumber: Hex }[];
  const launched = ev.map((l) => ({ token: getAddress(`0x${l.data.slice(26, 66)}`), block: BigInt(l.blockNumber) }));
  const rows: { token: Address; deployer: string; symbol: string; block: bigint }[] = [];
  for (let i = 0; i < launched.length; i += 150) {
    const chunk = launched.slice(i, i + 150);
    const info = await client.multicall({ contracts: chunk.map((l) => ({ address: KLIK, abi: KLIK_INFO, functionName: "tokenInfoByAddress", args: [l.token] })), allowFailure: true });
    chunk.forEach((l, j) => { const r = info[j]; if (r?.status === "success") rows.push({ ...l, deployer: String((r.result as readonly unknown[])[3]).toLowerCase(), symbol: String((r.result as readonly unknown[])[2]).slice(0, 20) }); });
  }
  klikIndex = { at: Date.now(), rows };
  return rows;
}

/**
 * Most Klik tokens are launched by Klik's own launcher account (a bot that deploys for users), so its "deployer" is
 * the platform, not a dev. An address with more than 50 launches a month is treated as that: no dev, no history.
 */
export async function isKlikPlatform(client: PublicClient, logs: PublicClient, deployer: Address): Promise<boolean> {
  const rows = await klikLaunches(client, logs).catch(() => []);
  return rows.filter((r) => r.deployer === deployer.toLowerCase()).length > 50;
}

export async function klikDevHistory(client: PublicClient, logs: PublicClient, dev: Address, exclude: Address, max = 10): Promise<DevHistory | null> {
  const head = await logs.getBlockNumber();
  const mine = (await klikLaunches(client, logs)).filter((r) => r.deployer === dev.toLowerCase() && r.token.toLowerCase() !== exclude.toLowerCase())
    .sort((a, b) => Number(b.block - a.block));
  const look = mine.slice(0, max);
  const devT = topic(dev);
  const results = await Promise.all(look.map(async (l) => {
    const range = { fromBlock: `0x${l.block.toString(16)}`, toBlock: `0x${head.toString(16)}` };
    const recent = { fromBlock: `0x${(head - DAY_BLOCKS).toString(16)}`, toBlock: `0x${head.toString(16)}` };
    const [outs, ins, lastDay] = await Promise.all([
      logs.request({ method: "eth_getLogs", params: [{ address: l.token, topics: [TRANSFER, devT], ...range }] } as never).catch(() => null) as Promise<{ topics: Hex[]; data: Hex }[] | null>,
      logs.request({ method: "eth_getLogs", params: [{ address: l.token, topics: [TRANSFER, null, devT], ...range }] } as never).catch(() => null) as Promise<{ topics: Hex[]; data: Hex }[] | null>,
      head - l.block > DAY_BLOCKS ? logs.request({ method: "eth_getLogs", params: [{ address: l.token, topics: [TRANSFER], ...recent }] } as never).catch(() => null) as Promise<unknown[] | null> : Promise.resolve(null),
    ]);
    const sum = (ls: { topics: Hex[]; data: Hex }[] | null, skipBurn: boolean) => (ls ?? []).filter((x) => !skipBurn || !BURN.has(`0x${x.topics[2]!.slice(26)}`)).reduce((a, x) => a + BigInt(x.data.slice(0, 66)), 0n);
    const got = sum(ins, false), sent = sum(outs, true);
    const soldPct = got > 0n ? Number((sent * 100n) / got) : null;
    const outcome: Outcome = soldPct !== null && soldPct >= 50 ? "dumped" : lastDay && lastDay.length === 0 ? "dead" : "active";
    return { token: l.token, symbol: l.symbol || null, outcome };
  }));
  const count = (o: Outcome) => results.filter((x) => x.outcome === o).length;
  return { launchpad: "Klik", launches: mine.length, checked: results.length, graduated: 0, dumped: count("dumped"), dead: count("dead"), active: count("active"), recent: results.slice(0, 5) };
}
