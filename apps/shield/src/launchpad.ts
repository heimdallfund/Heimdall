import { getAddress, parseAbi, type Address, type PublicClient } from "viem";

/**
 * Which Robinhood Chain launchpad a token came from, who launched it, and where it trades now.
 * Each launchpad is recognised from its own contracts (a call that only answers for its tokens), never from the name.
 * Sources: the launchpads' contracts on chain 4663 and Mobula's launchpad almanac (checked 2026-11-24).
 *
 * Trading models:
 *   curve   a launchpad bonding curve; Heimdall simulates buy and sell on it (Pons V2), or reports it (older curves)
 *   v3/v4   the token trades in a Uniswap pool from the start; the regular pool simulation covers it
 */
export interface Launch {
  launchpad: string;
  url?: string;
  model: "curve" | "v3" | "v4";
  dev: Address | null;
  curve?: Address;
  pool?: Address;
  graduated: boolean | null;
  progressPct: number | null;
  /** Pons V2: the curve takes `buy(ethIn, minOut, to)` with ETH and `sell(tokensIn, minOut, to)` after an approval. */
  simulate?: "ponsV2";
  /** The token a Pons V2 curve is priced in when it is not ETH (Pons allows other tokens as the pair). */
  pairToken?: Address;
  feePct?: number;
}

const PONS_V2_FACTORY = getAddress("0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e");
const HOOD = getAddress("0x5fcc1df0dc020cf454e742e9a8ae2554c37a452c");
const PRINTR = getAddress("0xb77726291b125515d0a7affeea2b04f2ff243172");
const ROBINFUN = getAddress("0xd861cb5dc71a0171e8f0f6586cadb069f3a35e4d");
const PONS_V1 = [getAddress("0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB"), getAddress("0x0c37a24F5D23A486FA692d1500881d698B1F77a4")];
const NOXA = getAddress("0xd9ec2db5f3d1b236843925949fe5bd8a3836fccb");
const DYOR = getAddress("0x80b42aed46d73f47119dc444bea28a9e68f32bf4");
const BOW = getAddress("0xc70e510e14710ea535cab7b2414860af63feab79");
const REALFUN = getAddress("0xa3A71925be892c609Ac4BE4EFe918Dc9C35fc5e8");
const KLIK = getAddress("0x16cF6788B762EE8969744586eD16fc5705140dd7");
const BOTTOM = getAddress("0x1bed2687321074a198302c004036b51923812b18");

/** Contracts that hold a launchpad token's liquidity or inventory: never counted as holders. */
export const LAUNCHPAD_CONTRACTS = new Set([PONS_V2_FACTORY, HOOD, PRINTR, ROBINFUN, ...PONS_V1, NOXA, DYOR, BOW, REALFUN, KLIK, BOTTOM,
  getAddress("0x736D76699C26D0d966744cAe304C000d471f7F35"), getAddress("0x31ca5E101941A93A7DD6d0497928700625CF54B5"), // Pons lockers
  getAddress("0xf46663171d1d0653fe7c3b8e42d43bccac137c56"), // Bottom.fun locker
].map((a) => a.toLowerCase()));

/** Uniswap v4 hooks that belong to launchpads (every token from that launchpad trades through it). */
export const LAUNCHPAD_HOOKS: Record<string, string> = {
  "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044": "Pons",
  "0x745d717620052a97a22deee2e5eba59583f3e0cc": "Klik",
  "0xd23c94bd8cbeb48c169c020e16a844aeab2368cc": "Bottom.fun",
};

const ABI = parseAbi([
  "function curve() view returns (address)",
  "function deployer() view returns (address)",
  "function factory() view returns (address)",
  "function graduated() view returns (bool)",
  "function getReserves() view returns (uint256, uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function pairToken() view returns (address)",
  "function isHoodToken(address) view returns (bool)",
  "function curves(address) view returns (uint256 virtualEth, uint256 virtualTokens, uint256 realEth, uint256 realTokens, uint256 tradeFeeBps, bool readyToGraduate, bool graduated, bool migrated, address creator)",
  "function getTelecoinId(address) view returns (bytes32)",
  "function getCurve(address) view returns (address basePair, uint256 totalCurves, uint256 maxTokenSupply, uint256 virtualReserve, uint256 reserve, uint256 completionThreshold)",
  "function getLaunchedToken(address) view returns (address token, address deployer, address pairedToken, address positionManager, uint256 positionId, uint256 dexId, uint256 launchConfigId, uint256 restrictionsEndBlock, uint256 supply, bool isToken0, uint24 poolFee, bool exists, uint256 initialBuyAmount)",
  "function graduationStatus(address) view returns (uint256 current, uint256 threshold, bool graduated)",
  "function graduationProgressBps(address) view returns (uint256)",
  "function deployerOf(address) view returns (address)",
  "function pool() view returns (address)",
  "function migrated() view returns (bool)",
  "function launches(address) view returns (address pool, uint256 nonce, uint8 mode, address feeWallet, address distributor, bool exists)",
  "function tokenInfoByAddress(address) view returns (address tokenAddress, string name, string symbol, address deployer, uint256 time, string metadata, uint256 marketCapInETH, uint256 totalFeesGenerated)",
]);
const ROBIN_ABI = parseAbi(["function curves(address) view returns (uint256 virtualEth, uint256 realEth, uint256 tokenReserve, uint256 raiseTarget, uint256 lpEth, uint256 treasuryEth, uint256 k, bool readyToGraduate, bool graduated, address creator, address feeRecipient, uint256 totalSupply)"]);
const DYOR_ABI = parseAbi(["function getLaunchedToken(address) view returns (address token, address deployer, address pairedToken, address positionManager, uint256 positionId, uint256 restrictionsEndBlock, uint256 supply, bool isToken0, uint24 poolFee, bool exists, uint256 initialBuyAmount, address pool, address feeRecipient, string metadataURI)", "function graduated(address) view returns (bool)", "function graduationProgressBps(address) view returns (uint256)"]);
const BOTTOM_ABI = parseAbi(["function launches(address) view returns (address token, address creator, bytes32 poolId, bytes32 socialClaimId, uint64 launchBlock, address factory, string metadataURI)"]);

const ZERO = /^0x0{40}$/i;
const pctOf = (a: bigint, b: bigint) => (b > 0n ? Math.min(100, Number((a * 10_000n) / b) / 100) : null);

export async function detectLaunch(client: PublicClient, raw: Address): Promise<Launch | null> {
  const token = getAddress(raw);
  const r = <T>(address: Address, functionName: string, args: unknown[] = [], abi: readonly unknown[] = ABI) =>
    client.readContract({ address, abi: abi as never, functionName: functionName as never, args: args as never }).then((v) => v as T).catch(() => null);

  // Pons V2 (active): the token names its own curve and deployer; the curve names the Pons factory.
  const curve = await r<Address>(token, "curve");
  if (curve && !ZERO.test(curve)) {
    const factory = await r<Address>(curve, "factory");
    if (factory && getAddress(factory) === PONS_V2_FACTORY) {
      const [dev, graduated, reserves, threshold, fee, pair] = await Promise.all([
        r<Address>(token, "deployer"), r<boolean>(curve, "graduated"), r<[bigint, bigint]>(curve, "getReserves"), r<bigint>(curve, "graduationThreshold"), r<bigint>(curve, "feeBps"), r<Address>(curve, "pairToken"),
      ]);
      return {
        launchpad: "Pons", url: "https://ponsfamily.com", model: "curve", dev: dev ? getAddress(dev) : null, curve: getAddress(curve),
        graduated, progressPct: graduated ? 100 : reserves && threshold ? pctOf(reserves[0], threshold) : null,
        simulate: graduated ? undefined : "ponsV2", feePct: fee === null ? undefined : Number(fee) / 100,
        pairToken: pair && !ZERO.test(pair) ? getAddress(pair) : undefined,
      };
    }
  }

  const [hood, telecoin, robin, ponsV1a, ponsV1b, noxa, dyor, bowDev, real, klik, bottom] = await Promise.all([
    r<boolean>(HOOD, "isHoodToken", [token]),
    r<`0x${string}`>(PRINTR, "getTelecoinId", [token]),
    r<readonly unknown[]>(ROBINFUN, "curves", [token], ROBIN_ABI),
    r<readonly unknown[]>(PONS_V1[0]!, "getLaunchedToken", [token]),
    r<readonly unknown[]>(PONS_V1[1]!, "getLaunchedToken", [token]),
    r<readonly unknown[]>(NOXA, "getLaunchedToken", [token]),
    r<readonly unknown[]>(DYOR, "getLaunchedToken", [token], DYOR_ABI),
    r<Address>(BOW, "deployerOf", [token]),
    r<readonly unknown[]>(REALFUN, "launches", [token]),
    r<readonly unknown[]>(KLIK, "tokenInfoByAddress", [token]),
    r<readonly unknown[]>(BOTTOM, "launches", [token], BOTTOM_ABI),
  ]);

  if (hood) {
    const c = await r<readonly unknown[]>(HOOD, "curves", [token]);
    const graduated = c ? Boolean(c[6]) || Boolean(c[7]) : null;
    return { launchpad: "hood.fun", url: "https://hood.fun", model: "curve", dev: c && !ZERO.test(String(c[8])) ? getAddress(String(c[8])) : null, curve: HOOD, graduated, progressPct: graduated ? 100 : null, feePct: c ? Number(c[4]) / 100 : undefined };
  }
  if (telecoin && !/^0x0{64}$/i.test(telecoin)) {
    const c = await r<readonly bigint[]>(PRINTR, "getCurve", [token]);
    const graduated = c ? c[5] === 0n : null;
    return { launchpad: "Printr", url: "https://printr.money", model: "curve", dev: null, curve: PRINTR, graduated, progressPct: graduated ? 100 : null };
  }
  if (robin && !ZERO.test(String(robin[9]))) {
    const graduated = Boolean(robin[8]);
    return { launchpad: "RobinFun", model: "curve", dev: getAddress(String(robin[9])), curve: ROBINFUN, graduated, progressPct: graduated ? 100 : pctOf(robin[1] as bigint, robin[3] as bigint) };
  }
  for (const [rec, name, fac] of [[ponsV1a, "Pons (V1)", PONS_V1[0]], [ponsV1b, "Pons (V1)", PONS_V1[1]], [noxa, "Noxa.fun", NOXA]] as const) {
    if (rec && rec[11] === true) {
      const g = await r<readonly unknown[]>(fac!, "graduationStatus", [token]);
      return { launchpad: name, model: "v3", dev: getAddress(String(rec[1])), graduated: g ? Boolean(g[2]) : null, progressPct: g ? (Boolean(g[2]) ? 100 : pctOf(g[0] as bigint, g[1] as bigint)) : null };
    }
  }
  if (dyor && dyor[9] === true) {
    const [g, bps] = await Promise.all([r<boolean>(DYOR, "graduated", [token], DYOR_ABI), r<bigint>(DYOR, "graduationProgressBps", [token], DYOR_ABI)]);
    return { launchpad: "DYOR.fun", model: "v3", dev: getAddress(String(dyor[1])), pool: getAddress(String(dyor[11])), graduated: g, progressPct: g ? 100 : bps === null ? null : Math.min(100, Number(bps) / 100) };
  }
  if (bowDev && !ZERO.test(bowDev)) {
    const [pool, migrated] = await Promise.all([r<Address>(token, "pool"), r<boolean>(token, "migrated")]);
    return { launchpad: "Bow.fun", model: "v3", dev: getAddress(bowDev), pool: pool && !ZERO.test(pool) ? getAddress(pool) : undefined, graduated: migrated, progressPct: migrated ? 100 : null };
  }
  if (real && real[5] === true) return { launchpad: "RealFun", model: "v3", dev: null, pool: getAddress(String(real[0])), graduated: null, progressPct: null };
  if (klik && !ZERO.test(String(klik[0])) && getAddress(String(klik[0])) === token) return { launchpad: "Klik", url: "https://klik.finance", model: "v4", dev: getAddress(String(klik[3])), graduated: null, progressPct: null };
  if (bottom && !ZERO.test(String(bottom[0])) && getAddress(String(bottom[0])) === token) return { launchpad: "Bottom.fun", model: "v4", dev: getAddress(String(bottom[1])), graduated: null, progressPct: null };
  return null;
}

/** Pons V2 launches by the same wallet in the last ~10M blocks (the factory's launch event carries the creator). */
export async function ponsLaunchesBy(logs: PublicClient, dev: Address): Promise<Address[]> {
  const latest = await logs.getBlockNumber();
  const from = latest > 9_900_000n ? latest - 9_900_000n : 0n;
  const res = await logs.request({
    method: "eth_getLogs",
    params: [{ address: PONS_V2_FACTORY, fromBlock: `0x${from.toString(16)}`, toBlock: "latest", topics: ["0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607", null, null, `0x${dev.slice(2).toLowerCase().padStart(64, "0")}`] }],
  }) as { topics: `0x${string}`[] }[];
  return res.map((l) => getAddress(`0x${l.topics[1]!.slice(26)}`));
}
