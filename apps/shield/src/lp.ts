import { decodeAbiParameters, getAddress, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { LAUNCHPAD_CONTRACTS } from "./launchpad.js";
import { POOL_MANAGER } from "./v4hooks.js";
import type { Finding } from "./types.js";
import { eachWindow } from "./windowlogs.js";

/**
 * Who can pull a pool's liquidity. Every position in the pool is found from its events (Uniswap v3 Mint +
 * IncreaseLiquidity, Uniswap v4 ModifyLiquidity), its current size is read onchain, and its owner is classified:
 * burned, locked by a launchpad or locker, held by a contract, or held by a plain wallet that can remove it any time.
 */
export interface LpOwnership {
  positions: number;
  burnedPct: number;
  lockedPct: number;
  contractPct: number;
  walletPct: number;
  /** The wallet holding the most liquidity, when wallets hold any. */
  topWallet: Address | null;
}
export interface Liquidity { pairEth: number | null; lp: LpOwnership | null; /** Liquidity was added to the pool and all of it has been taken out since. */ removed?: boolean }

const WETH: Address = getAddress("0x0bd7d308f8e1639fab988df18a8011f41eacad73");
const MINT_V3 = "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde";
const INCREASE = "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f";
const MODIFY_V4 = "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec";
const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);
const NFT = parseAbi(["function ownerOf(uint256) view returns (address)"]);
const NPM = parseAbi(["function positions(uint256) view returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)"]);
const BAL = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const STEP = 10_000_000n;

interface Log { transactionHash: Hex; address: Address; topics: Hex[]; data: Hex; blockNumber: Hex }

async function wideLogs(logs: PublicClient, filter: { address: Address; topics: (Hex | null)[] }): Promise<Log[]> {
  const head = await logs.getBlockNumber();
  return eachWindow(head, STEP, (from, to) => logs.request({ method: "eth_getLogs", params: [{ address: filter.address, topics: filter.topics, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }] } as never) as Promise<Log[]>);
}

async function classify(client: PublicClient, holders: Map<string, bigint>): Promise<LpOwnership | null> {
  const total = [...holders.values()].reduce((a, b) => a + b, 0n);
  if (total <= 0n) return null;
  const share = { burned: 0n, locked: 0n, contract: 0n, wallet: 0n };
  let topWallet: [string, bigint] | null = null;
  await Promise.all([...holders].map(async ([who, liq]) => {
    if (BURN.has(who)) share.burned += liq;
    else if (LAUNCHPAD_CONTRACTS.has(who)) share.locked += liq;
    else {
      const code = await client.getCode({ address: who as Address }).catch(() => undefined);
      // EIP-7702 delegated wallets (0xef0100…) are still wallets
      if (code && code !== "0x" && !code.startsWith("0xef0100")) share.contract += liq;
      else { share.wallet += liq; if (!topWallet || liq > topWallet[1]) topWallet = [who, liq]; }
    }
  }));
  const p = (x: bigint) => Math.round(Number((x * 10_000n) / total)) / 100;
  return { positions: holders.size, burnedPct: p(share.burned), lockedPct: p(share.locked), contractPct: p(share.contract), walletPct: p(share.wallet), topWallet: topWallet ? getAddress((topWallet as [string, bigint])[0]) : null };
}

/** Uniswap v3: positions minted through the NonfungiblePositionManager are tracked to their NFT owner today. */
export async function v3Liquidity(client: PublicClient, logs: PublicClient, pool: Address): Promise<Liquidity> {
  const pairEth = await client.readContract({ address: WETH, abi: BAL, functionName: "balanceOf", args: [pool] }).then((b) => Number(b) / 1e18).catch(() => null);
  const mints = (await wideLogs(logs, { address: pool, topics: [MINT_V3] }).catch(() => [])).slice(-40);
  const holders = new Map<string, bigint>();
  const seen = new Set<string>();
  await Promise.all(mints.map(async (m) => {
    const npm = getAddress(`0x${m.data.slice(26, 66)}`); // Mint.sender (not indexed) is the first data word
    const owner = getAddress(`0x${m.topics[1]!.slice(26)}`);
    if (owner !== npm) { // minted directly by a contract: it holds the position itself
      const [liq] = decodeAbiParameters([{ type: "uint128" }], `0x${m.data.slice(66, 130)}` as Hex);
      holders.set(owner.toLowerCase(), (holders.get(owner.toLowerCase()) ?? 0n) + liq);
      return;
    }
    const rc = await client.getTransactionReceipt({ hash: m.transactionHash }).catch(() => null);
    for (const l of rc?.logs ?? []) {
      if (l.address.toLowerCase() !== npm.toLowerCase() || l.topics[0] !== INCREASE) continue;
      const id = BigInt(l.topics[1]!);
      if (seen.has(`${npm}:${id}`)) continue;
      seen.add(`${npm}:${id}`);
      const [pos, who] = await Promise.all([
        client.readContract({ address: npm, abi: NPM, functionName: "positions", args: [id] }).catch(() => null),
        client.readContract({ address: npm, abi: NFT, functionName: "ownerOf", args: [id] }).catch(() => "0x0000000000000000000000000000000000000000" as Address),
      ]);
      const liq = pos ? (pos[7] as bigint) : 0n;
      if (liq > 0n) holders.set(who.toLowerCase(), (holders.get(who.toLowerCase()) ?? 0n) + liq);
    }
  }));
  const lp = await classify(client, holders);
  return { pairEth, lp, removed: mints.length > 0 && !lp };
}

/** Uniswap v4: ModifyLiquidity events of the pool, netted per position; a position manager's salt is the NFT id. */
export async function v4Liquidity(client: PublicClient, logs: PublicClient, poolId: Hex): Promise<Liquidity> {
  const mods = await wideLogs(logs, { address: POOL_MANAGER, topics: [MODIFY_V4, poolId] }).catch(() => []);
  const pos = new Map<string, { sender: Address; salt: Hex; liq: bigint }>();
  for (const m of mods) {
    const sender = getAddress(`0x${m.topics[2]!.slice(26)}`);
    const [tl, tu, delta, salt] = decodeAbiParameters([{ type: "int24" }, { type: "int24" }, { type: "int256" }, { type: "bytes32" }], m.data);
    const k = `${sender}:${tl}:${tu}:${salt}`;
    const cur = pos.get(k) ?? { sender, salt, liq: 0n };
    cur.liq += delta;
    pos.set(k, cur);
  }
  const everAdded = mods.some((m) => decodeAbiParameters([{ type: "int24" }, { type: "int24" }, { type: "int256" }, { type: "bytes32" }], m.data)[2] > 0n);
  const holders = new Map<string, bigint>();
  await Promise.all([...pos.values()].filter((p) => p.liq > 0n).map(async (p) => {
    const id = BigInt(p.salt);
    const nftOwner = id > 0n ? await client.readContract({ address: p.sender, abi: NFT, functionName: "ownerOf", args: [id] }).catch(() => null) : null;
    const who = (nftOwner ?? p.sender).toLowerCase();
    holders.set(who, (holders.get(who) ?? 0n) + p.liq);
  }));
  const lp = await classify(client, holders);
  return { pairEth: null, lp, removed: everAdded && !lp };
}

export function liquidityFindings(l: Liquidity, dev: Address | null): Finding[] {
  const F: Finding[] = [];
  if (l.pairEth !== null) {
    if (l.pairEth < 0.05) F.push({ code: "LOW_LIQUIDITY", severity: "warn", message: `Very little liquidity: the pool holds ${l.pairEth.toFixed(4)} ETH, so even a small sell moves the price a lot.` });
    else F.push({ code: "LIQUIDITY", severity: "info", message: `The pool holds ${l.pairEth < 10 ? l.pairEth.toFixed(3) : l.pairEth.toFixed(1)} ETH of liquidity.` });
  }
  if (l.removed) F.push({ code: "LIQUIDITY_REMOVED", severity: "deny", message: "Liquidity was added to its pool and has all been taken out since: the token can no longer be sold there. This is what a rug pull leaves behind." });
  const lp = l.lp;
  if (!lp) return F;
  if (lp.walletPct >= 50) {
    const isDev = dev && lp.topWallet && dev.toLowerCase() === lp.topWallet.toLowerCase();
    F.push({ code: "LP_REMOVABLE", severity: "warn", message: `${lp.walletPct.toFixed(0)}% of the pool's liquidity belongs to ${isDev ? "the dev's wallet" : "a wallet"} (${lp.topWallet}), which can remove it at any time: the classic rug pull.` });
  } else if (lp.burnedPct + lp.lockedPct >= 90) {
    F.push({ code: "LP_LOCKED", severity: "info", message: `${(lp.burnedPct + lp.lockedPct).toFixed(0)}% of the pool's liquidity is ${lp.burnedPct >= lp.lockedPct ? "burned" : "locked by the launchpad"}: it cannot be pulled.` });
  } else if (lp.contractPct >= 50) {
    F.push({ code: "LP_IN_CONTRACT", severity: "info", message: `${lp.contractPct.toFixed(0)}% of the pool's liquidity is held by a contract; whether it can be withdrawn depends on that contract.` });
  }
  return F;
}
