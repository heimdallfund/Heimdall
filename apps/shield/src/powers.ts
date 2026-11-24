import { encodeFunctionData, getAddress, parseAbi, toFunctionSelector, toHex, type Address, type Hex, type PublicClient } from "viem";
import { parseLogs, decodeRevert, STRANGER, type RawLog } from "./simulate.js";
import type { Finding } from "./types.js";

/**
 * Deeper Token Check tests, each run as a simulation on the current chain state, never guessed from source code:
 *   - what the owner can do to holders: mint, block a wallet, pause transfers, raise the sell tax, replace the code
 *   - whether selling still works a week later (time-locked honeypots)
 *   - whether a bigger buy and sell work like a small one (max-transaction limits, taxes that grow with size)
 * Owner actions are only tried when the contract's bytecode contains the function; each is then executed as the
 * owner in the simulation, against a simulated buyer, so a finding means the power exists and works today.
 */

export interface Call { from: Address; to: Address; data: Hex; value?: bigint }
/** How to buy and sell this token where it trades. The last call of buy() is the buy, the last of sell() is the sell. */
export interface Route { buy(wei: bigint): Call[]; sell(amount: bigint): Call[]; sink: Address; bigWei: bigint; label: string }
export interface Powers {
  renounced: boolean;
  upgradeable: boolean;
  mint: boolean;
  blacklist: boolean;
  pause: boolean;
  /** Highest sell tax the owner could set in the simulation, in percent; null when no tax setter was found or it failed. */
  maxSellTaxPct: number | null;
  /** Selling still worked in a simulation one week later; null when not tested. */
  sellLater: boolean | null;
  /** A 0.1 ETH buy and sell worked like a small one; null when not tested. */
  bigTrade: boolean | null;
  /** Whether blacklist, pause and tax powers could be tested (they need a live owner and a working sell). */
  ownerTested: boolean;
}

export const BUYER: Address = getAddress("0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0");
const ERC20 = parseAbi(["function transfer(address,uint256) returns (bool)"]);
const ZERO = /^0x0{40}$/i;

type SimCall = { status: string; logs?: RawLog[]; returnData?: Hex; error?: { data?: Hex; message?: string } };
interface Block { calls: Call[]; laterSeconds?: bigint; overrides?: Record<string, { balance: Hex }> }

/** eth_simulateV1 over one or more blocks; a later block can move the clock forward. Returns each block's call results. */
export async function simBlocks(client: PublicClient, blocks: Block[], extraBalance: Address[] = []): Promise<SimCall[][]> {
  const head = blocks.some((b) => b.laterSeconds) ? await client.getBlock().catch(() => null) : null;
  const balances = Object.fromEntries([BUYER, ...extraBalance].map((a) => [a, { balance: toHex(10n ** 20n) }]));
  const res = await client.request({
    method: "eth_simulateV1" as never,
    params: [{
      blockStateCalls: blocks.map((b, i) => ({
        ...(i === 0 ? { stateOverrides: balances } : {}),
        ...(b.laterSeconds && head ? { blockOverrides: { time: toHex(head.timestamp + b.laterSeconds) } } : {}),
        calls: b.calls.map((c) => ({ from: c.from, to: c.to, data: c.data, value: toHex(c.value ?? 0n) })),
      })),
      traceTransfers: true, validation: false,
    }, "latest"] as never,
  }) as { calls: SimCall[] }[];
  return res.map((b) => b.calls ?? []);
}

const net = (logs: RawLog[] | undefined, token: Address, who: Address) => {
  const tr = parseLogs(logs ?? []).transfers.filter((t) => t.asset.toLowerCase() === token.toLowerCase());
  return tr.filter((t) => t.to.toLowerCase() === who.toLowerCase()).reduce((a, t) => a + t.amount, 0n)
    - tr.filter((t) => t.from.toLowerCase() === who.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
};
const into = (logs: RawLog[] | undefined, token: Address, sink: Address) =>
  parseLogs(logs ?? []).transfers.filter((t) => t.asset.toLowerCase() === token.toLowerCase() && t.to.toLowerCase() === sink.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
const taxOf = (sent: bigint, got: bigint) => (sent > 0n ? Math.max(0, Number(((sent - got) * 10_000n) / sent) / 100) : null);

/** Buy, then optionally run `between` calls (in the same block or a later one), then sell everything bought. */
async function buyThenSell(client: PublicClient, r: Route, token: Address, o: { wei?: bigint; between?: Call[]; laterSeconds?: bigint; owner?: Address | null } = {}) {
  const buy = r.buy(o.wei ?? 10n ** 15n);
  const [first] = await simBlocks(client, [{ calls: buy }], o.owner ? [o.owner] : []);
  const b = first?.[buy.length - 1];
  if (!b || b.status !== "0x1") return { buyOk: false, sellOk: false, tax: null as number | null, reason: decodeRevert(b?.error?.data ?? b?.returnData, b?.error?.message) };
  const bought = net(b.logs, token, BUYER);
  if (bought <= 0n) return { buyOk: true, sellOk: false, tax: null, reason: "nothing arrived" };
  const sell = r.sell(bought);
  const after = [...(o.between ?? []), ...sell];
  const blocks: Block[] = o.laterSeconds ? [{ calls: buy }, { calls: after, laterSeconds: o.laterSeconds }] : [{ calls: [...buy, ...after] }];
  const res = await simBlocks(client, blocks, o.owner ? [o.owner] : []);
  const last = res.at(-1)!;
  const offset = o.laterSeconds ? 0 : buy.length;
  const betweenOk = (o.between ?? []).every((_, i) => last[offset + i]?.status === "0x1");
  const s = last.at(-1);
  if (!s) return { buyOk: true, sellOk: false, tax: null, reason: "no result", betweenOk };
  if (s.status !== "0x1") return { buyOk: true, sellOk: false, tax: null, reason: decodeRevert(s.error?.data ?? s.returnData, s.error?.message), betweenOk };
  return { buyOk: true, sellOk: true, tax: taxOf(bought, into(s.logs, token, r.sink)), betweenOk, bought };
}

// ---- owner powers: candidate functions, tried only when their selector is in the bytecode

type Arg = "buyer" | "owner" | "true" | "false" | "buyers" | "amount" | "tax";
interface Candidate { sig: string; args: Arg[] }
const MINT: Candidate[] = [
  { sig: "mint(address,uint256)", args: ["owner", "amount"] }, { sig: "mint(uint256)", args: ["amount"] },
  { sig: "mintTo(address,uint256)", args: ["owner", "amount"] }, { sig: "_mint(address,uint256)", args: ["owner", "amount"] },
];
const BLACKLIST: Candidate[] = [
  { sig: "blacklist(address)", args: ["buyer"] }, { sig: "addToBlacklist(address)", args: ["buyer"] }, { sig: "addBlacklist(address)", args: ["buyer"] },
  { sig: "blacklistAddress(address)", args: ["buyer"] }, { sig: "setBlacklist(address,bool)", args: ["buyer", "true"] },
  { sig: "blacklistAddress(address,bool)", args: ["buyer", "true"] }, { sig: "setBlacklisted(address,bool)", args: ["buyer", "true"] },
  { sig: "setIsBlacklisted(address,bool)", args: ["buyer", "true"] }, { sig: "updateBlacklist(address,bool)", args: ["buyer", "true"] },
  { sig: "setBlacklistWallet(address,bool)", args: ["buyer", "true"] }, { sig: "setBot(address,bool)", args: ["buyer", "true"] },
  { sig: "setBots(address[],bool)", args: ["buyers", "true"] }, { sig: "addBots(address[])", args: ["buyers"] },
  { sig: "blockBots(address[])", args: ["buyers"] }, { sig: "setSniper(address,bool)", args: ["buyer", "true"] },
];
const PAUSE: Candidate[] = [
  { sig: "pause()", args: [] }, { sig: "setPaused(bool)", args: ["true"] }, { sig: "setTradingEnabled(bool)", args: ["false"] },
  { sig: "setTrading(bool)", args: ["false"] }, { sig: "setTradingStatus(bool)", args: ["false"] }, { sig: "enableTrading(bool)", args: ["false"] },
  { sig: "toggleTrading()", args: [] }, { sig: "freeze()", args: [] },
];
const TAX: Candidate[] = [
  { sig: "setSellTax(uint256)", args: ["tax"] }, { sig: "setSellFee(uint256)", args: ["tax"] }, { sig: "setTax(uint256)", args: ["tax"] },
  { sig: "setFee(uint256)", args: ["tax"] }, { sig: "setTaxes(uint256,uint256)", args: ["tax", "tax"] }, { sig: "setFees(uint256,uint256)", args: ["tax", "tax"] },
  { sig: "updateFees(uint256,uint256)", args: ["tax", "tax"] }, { sig: "setTaxFeePercent(uint256)", args: ["tax"] },
  { sig: "updateSellFees(uint256,uint256,uint256)", args: ["tax", "tax", "tax"] }, { sig: "setSellFees(uint256,uint256,uint256)", args: ["tax", "tax", "tax"] },
];

const inCode = (code: string, sig: string) => code.includes(`63${toFunctionSelector(sig).slice(2)}`);
function encode(c: Candidate, owner: Address, tax: bigint): Hex {
  const types = c.sig.slice(c.sig.indexOf("(") + 1, -1).split(",").filter(Boolean);
  const abi = parseAbi([`function ${c.sig.slice(0, c.sig.indexOf("("))}(${types.join(",")})`]);
  const args = c.args.map((a) => ({ buyer: BUYER, owner, true: true, false: false, buyers: [BUYER], amount: 10n ** 30n, tax }[a]));
  return encodeFunctionData({ abi, args } as never);
}

const SLOT_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const SLOT_ADMIN = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const SLOT_BEACON = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
const slotAddr = (v?: Hex) => (v && !/^0x0*$/.test(v) ? getAddress(`0x${v.slice(-40)}`) : null);

/** The code that actually runs: the implementation behind an EIP-1967 or beacon proxy, or the contract itself. */
async function liveCode(client: PublicClient, token: Address, code: Hex) {
  const [impl, admin, beacon] = await Promise.all([SLOT_IMPL, SLOT_ADMIN, SLOT_BEACON].map((slot) => client.getStorageAt({ address: token, slot: slot as Hex }).catch(() => undefined)));
  let implementation = slotAddr(impl);
  if (!implementation && slotAddr(beacon)) {
    implementation = await client.readContract({ address: slotAddr(beacon)!, abi: parseAbi(["function implementation() view returns (address)"]), functionName: "implementation" }).catch(() => null);
  }
  // EIP-1167 minimal clones point at fixed code: not upgradeable
  const clone = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code);
  if (clone) implementation = getAddress(`0x${clone[1]}`);
  const runs = implementation ? await client.getCode({ address: implementation }).catch(() => code) ?? code : code;
  return { code: runs.toLowerCase(), upgradeable: !clone && !!(slotAddr(impl) || slotAddr(beacon)), admin: slotAddr(admin) };
}

/**
 * Runs every deeper test it can for one token and returns the findings. `route` is null when the token has no market
 * Heimdall can simulate (the owner-power tests that need a buy are then skipped).
 */
export async function deepTests(client: PublicClient, token: Address, code: Hex, owner: Address | null, route: Route | null): Promise<{ findings: Finding[]; powers: Powers }> {
  const F: Finding[] = [];
  const add = (code: string, severity: Finding["severity"], message: string) => F.push({ code, severity, message });
  const live = await liveCode(client, token, code);
  const ownerRead = await client.readContract({ address: token, abi: parseAbi(["function owner() view returns (address)"]), functionName: "owner" }).catch(() => undefined);
  const powers: Powers = { renounced: ownerRead !== undefined && ZERO.test(ownerRead), upgradeable: false, mint: false, blacklist: false, pause: false, maxSellTaxPct: null, sellLater: null, bigTrade: null, ownerTested: false };

  if (live.upgradeable && !(live.admin && ZERO.test(live.admin))) {
    powers.upgradeable = true;
    add("UPGRADEABLE", "warn", "The contract is an upgradeable proxy: whoever controls it can replace its code, so today's checks may not hold tomorrow.");
  }
  if (powers.renounced && !powers.upgradeable) add("OWNERSHIP_RENOUNCED", "info", "Ownership is renounced: no owner can change the contract.");

  // baseline trade tests (no owner involved)
  let base: Awaited<ReturnType<typeof buyThenSell>> | null = null;
  if (route) {
    const [now, later, big] = await Promise.all([
      buyThenSell(client, route, token).catch(() => null),
      buyThenSell(client, route, token, { laterSeconds: 7n * 86_400n }).catch(() => null),
      route.bigWei > 0n ? buyThenSell(client, route, token, { wei: route.bigWei }).catch(() => null) : Promise.resolve(null),
    ]);
    base = now;
    if (now?.sellOk && later) powers.sellLater = later.sellOk && !(later.tax !== null && now.tax !== null && later.tax - now.tax >= 10);
    if (now?.sellOk && big) powers.bigTrade = big.buyOk && big.sellOk && !(big.tax !== null && now.tax !== null && big.tax - now.tax >= 10);
    if (now?.sellOk && later && !later.sellOk && later.buyOk) {
      add("SELL_BLOCKED_LATER", "deny", `Selling works now, but fails in a simulation one week later (${later.reason}): a time-locked honeypot.`);
    } else if (now?.sellOk && later?.sellOk && now.tax !== null && later.tax !== null && later.tax - now.tax >= 10) {
      add("TAX_RISES_LATER", "warn", `The sell tax rises from ${now.tax.toFixed(1)}% now to ${later.tax.toFixed(1)}% in a simulation one week later.`);
    }
    const bigEth = Number(route.bigWei) / 1e18;
    if (now?.buyOk && big && !big.buyOk) {
      add("MAX_BUY_LIMIT", "warn", `A small buy works but a ${bigEth} ETH buy reverts (${big.reason}): a maximum buy or wallet limit.`);
    } else if (now?.sellOk && big?.buyOk && !big.sellOk) {
      add("SELL_LIMIT", "warn", `A small sell works but selling a ${bigEth} ETH position reverts (${big.reason}): you may not be able to sell all at once.`);
    } else if (now?.sellOk && big?.sellOk && now.tax !== null && big.tax !== null && big.tax - now.tax >= 10) {
      add("TAX_GROWS_WITH_SIZE", "warn", `The sell tax is ${now.tax.toFixed(1)}% on a small sell but ${big.tax.toFixed(1)}% on a ${bigEth} ETH sell.`);
    }
  }

  // owner powers: only with a live owner, only functions present in the code, each executed as the owner
  if (!owner || powers.renounced) { powers.ownerTested = !!base?.sellOk; return { findings: F, powers }; }
  powers.ownerTested = !!route && !!base?.sellOk;
  const present = (list: Candidate[]) => list.filter((c) => inCode(live.code, c.sig)).slice(0, 4);
  const asOwner = (c: Candidate, tax = 99n): Call => ({ from: owner, to: token, data: encode(c, owner, tax) });

  const mintTests = present(MINT).map(async (c) => {
    const [r] = await simBlocks(client, [{ calls: [asOwner(c)] }], [owner]);
    const minted = parseLogs(r?.[0]?.logs ?? []).transfers.some((t) => t.asset.toLowerCase() === token.toLowerCase() && ZERO.test(t.from));
    return r?.[0]?.status === "0x1" && minted;
  });
  const sellBlockedBy = (list: Candidate[]) => present(list).map(async (c) => {
    if (!route || !base?.sellOk) return false;
    const r = await buyThenSell(client, route, token, { between: [asOwner(c)], owner }).catch(() => null);
    return !!r && r.betweenOk === true && r.buyOk && !r.sellOk;
  });
  const pauseTests = present(PAUSE).map(async (c) => {
    if (!route || !base?.sellOk) return false;
    const buy = route.buy(10n ** 15n);
    const [res] = await simBlocks(client, [{ calls: [...buy, asOwner(c), { from: BUYER, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [STRANGER, 1n] }) }] }], [owner]);
    return res?.[buy.length]?.status === "0x1" && res?.[buy.length + 1]?.status !== "0x1";
  });
  const taxTests = present(TAX).map(async (c) => {
    if (!route || !base?.sellOk) return null;
    let worst: number | null = null;
    for (const v of [99n, 9_900n, 50n, 25n]) {
      const r = await buyThenSell(client, route, token, { between: [asOwner(c, v)], owner }).catch(() => null);
      if (!r || !r.betweenOk) continue;
      const t = r.sellOk ? r.tax : 100;
      if (t !== null && (worst === null || t > worst)) worst = t;
      if (worst !== null && worst >= 50) break;
    }
    return worst;
  });
  const [mints, blocks, pauses, taxes] = await Promise.all([
    Promise.all(mintTests.map((p) => p.catch(() => false))),
    Promise.all(sellBlockedBy(BLACKLIST).map((p) => p.catch(() => false))),
    Promise.all(pauseTests.map((p) => p.catch(() => false))),
    Promise.all(taxTests.map((p) => p.catch(() => null))),
  ]);
  powers.mint = mints.some(Boolean);
  powers.blacklist = blocks.some(Boolean);
  powers.pause = pauses.some(Boolean);
  const maxTax = taxes.filter((t): t is number => t !== null).sort((a, b) => b - a)[0] ?? null;
  powers.maxSellTaxPct = maxTax;

  if (powers.mint) add("OWNER_CAN_MINT", "warn", "The owner can create new tokens at will (tested in the simulation), diluting every holder.");
  if (powers.blacklist) add("OWNER_CAN_BLACKLIST", "warn", "The owner can block a wallet from selling: in the simulation, a buyer it blocked could no longer sell.");
  if (powers.pause) add("OWNER_CAN_PAUSE", "warn", "The owner can stop all transfers: in the simulation, a holder could not move the tokens after the owner paused them.");
  if (base?.tax !== undefined && maxTax !== null && maxTax - (base?.tax ?? 0) >= 10) {
    add("OWNER_CAN_RAISE_TAX", maxTax >= 50 ? "warn" : "info", maxTax >= 100
      ? "The owner can make selling impossible by changing the tax settings (tested in the simulation)."
      : `The owner can raise the sell tax to ${maxTax.toFixed(0)}% at any time (tested in the simulation).`);
  }
  return { findings: F, powers };
}
