import { encodeFunctionData, getAddress, maxUint256, parseAbi, toHex, type Address, type Hex, type PublicClient } from "viem";
import { isBlocklisted, blocklistEntries } from "./blocklist.js";
import { fakeTokenCheck } from "./impersonation.js";
import { TOKENS } from "./registry.js";
import { parseLogs, decodeRevert, probeReceivedToken, STRANGER, type RawLog } from "./simulate.js";
import type { Finding, Verdict } from "./types.js";

/**
 * Token Check: is a token safe to buy? Finds its Uniswap v3 pool against WETH, then simulates on the current chain
 * state, with a throwaway buyer that is given 1 ETH for the simulation only:
 *   buy → transfer → approve + sell back, and whether a stranger or the owner can pull the tokens out of the wallet.
 * Taxes are measured from the Transfer events (what left the pool vs what arrived), so no price quote is needed.
 */
export const UNISWAP_V3_FACTORY: Address = getAddress("0x1f7d7550b1b028f7571e69a784071f0205fd2efa");
export const SWAP_ROUTER_02: Address = getAddress("0xcaf681a66d020601342297493863e78c959e5cb2");
export const WETH: Address = getAddress("0x0bd7d308f8e1639fab988df18a8011f41eacad73");
const FEES = [100, 500, 3000, 10000] as const;
const BUYER: Address = getAddress("0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0");
const BUY_WEI = 10n ** 15n; // 0.001 ETH: small enough to fit any pool, large enough to measure a tax

const FACTORY_ABI = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const POOL_ABI = parseAbi(["function liquidity() view returns (uint128)"]);
const ERC20 = parseAbi([
  "function symbol() view returns (string)", "function name() view returns (string)", "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)", "function owner() view returns (address)",
  "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)",
]);
const ROUTER_ABI = parseAbi(["function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256)"]);

export interface TokenCheck {
  token: Address;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  totalSupply: string | null;
  owner: Address | null;
  verdict: Verdict;
  riskScore: number;
  findings: Finding[];
  pool: { address: Address; fee: number; pair: "WETH"; liquidity: string } | null;
  buy: { ok: boolean; taxPct: number | null; reason?: string } | null;
  sell: { ok: boolean; taxPct: number | null; reason?: string } | null;
  transfer: { ok: boolean; taxPct: number | null; reason?: string } | null;
  pullableBy: ("anyone" | "owner")[];
  checkedAt: number;
}

const pct = (sent: bigint, got: bigint) => (sent > 0n ? Math.max(0, Number(((sent - got) * 10_000n) / sent) / 100) : null);

async function findPool(client: PublicClient, token: Address) {
  const pools = await Promise.all(FEES.map(async (fee) => {
    const address = await client.readContract({ address: UNISWAP_V3_FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [WETH, token, fee] }).catch(() => undefined);
    if (!address || /^0x0{40}$/i.test(address)) return null;
    const liquidity = await client.readContract({ address, abi: POOL_ABI, functionName: "liquidity" }).catch(() => 0n);
    return { address: getAddress(address), fee, liquidity };
  }));
  return pools.filter((p): p is NonNullable<typeof p> => !!p && p.liquidity > 0n).sort((a, b) => (b.liquidity > a.liquidity ? 1 : -1))[0] ?? null;
}

async function sim(client: PublicClient, calls: { from: Address; to: Address; data: Hex; value?: bigint }[]) {
  const res: any = await client.request({
    method: "eth_simulateV1" as any,
    params: [{
      blockStateCalls: [{ stateOverrides: { [BUYER]: { balance: toHex(10n ** 18n) } }, calls: calls.map((c) => ({ from: c.from, to: c.to, data: c.data, value: toHex(c.value ?? 0n) })) }],
      traceTransfers: true, validation: false,
    }, "latest"] as any,
  });
  return (res?.[0]?.calls ?? []) as { status: string; logs?: RawLog[]; returnData?: Hex; error?: { data?: Hex; message?: string } }[];
}

export async function tokenCheck(client: PublicClient, raw: Address, now = Date.now()): Promise<TokenCheck> {
  const token = getAddress(raw);
  const F: Finding[] = [];
  const add = (code: string, severity: Finding["severity"], message: string) => F.push({ code, severity, message });
  const read = <T>(functionName: "symbol" | "name" | "decimals" | "totalSupply" | "owner") =>
    client.readContract({ address: token, abi: ERC20, functionName } as never).then((v) => v as T).catch(() => null);

  const [code, symbol, name, decimals, supply, owner, pool, fake] = await Promise.all([
    client.getCode({ address: token }).catch(() => undefined),
    read<string>("symbol"), read<string>("name"), read<number>("decimals"), read<bigint>("totalSupply"), read<Address>("owner"),
    findPool(client, token),
    fakeTokenCheck(client, token).catch(() => undefined),
  ]);
  const out: TokenCheck = {
    token, symbol, name, decimals: decimals === null ? null : Number(decimals), totalSupply: supply === null ? null : supply.toString(),
    owner: owner && !/^0x0{40}$/i.test(owner) ? getAddress(owner) : null,
    verdict: "ALLOW", riskScore: 0, findings: F, pool: null, buy: null, sell: null, transfer: null, pullableBy: [], checkedAt: now,
  };

  if (!code || code === "0x") {
    add("NOT_A_CONTRACT", "deny", "There is no contract at this address, so it is not a token.");
    return finish(out);
  }
  if (TOKENS[token.toLowerCase()]) add("KNOWN_TOKEN", "info", `This is the real ${TOKENS[token.toLowerCase()]!.symbol}.`);
  if (symbol === null || decimals === null) add("NOT_ERC20", "warn", "The contract does not answer symbol() or decimals(), so wallets cannot treat it as a normal token.");
  if (isBlocklisted(token)) {
    const e = blocklistEntries().find((b) => b.address.toLowerCase() === token.toLowerCase());
    add("BLOCKLISTED_CONTRACT", "deny", `On the Heimdall blocklist${e?.label ? `: ${e.label}` : ""}.`);
  }
  if (fake) {
    if (fake.by === "symbol") add("FAKE_TOKEN", "deny", `Calls itself ${fake.symbol}, but the real ${fake.symbol} is ${fake.real}.`);
    else add("FAKE_TOKEN", "warn", `Uses the name of ${fake.symbol} but is not the real ${fake.symbol} (${fake.real}).`);
  }
  if (out.owner) add("HAS_OWNER", "info", `Has an owner (${out.owner}) who may hold special powers over the contract.`);

  if (!pool) {
    add("NO_POOL", "warn", "No Uniswap v3 pool against WETH with liquidity: it cannot be bought or sold there, and the buy and sell could not be simulated.");
    return finish(out);
  }
  out.pool = { address: pool.address, fee: pool.fee, pair: "WETH", liquidity: pool.liquidity.toString() };

  // Buy
  const buyData = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: WETH, tokenOut: token, fee: pool.fee, recipient: BUYER, amountIn: BUY_WEI, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] });
  const buyCall = { from: BUYER, to: SWAP_ROUTER_02, data: buyData, value: BUY_WEI };
  let bought = 0n;
  try {
    const [b] = await sim(client, [buyCall]);
    if (!b || b.status !== "0x1") {
      out.buy = { ok: false, taxPct: null, reason: decodeRevert(b?.error?.data ?? b?.returnData, b?.error?.message) };
      add("BUY_FAILS", "deny", `Buying reverts: ${out.buy.reason}.`);
      return finish(out);
    }
    const tr = parseLogs(b.logs ?? []).transfers.filter((t) => t.asset.toLowerCase() === token.toLowerCase());
    const fromPool = tr.filter((t) => t.from.toLowerCase() === pool.address.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
    bought = tr.filter((t) => t.to.toLowerCase() === BUYER.toLowerCase()).reduce((a, t) => a + t.amount, 0n) - tr.filter((t) => t.from.toLowerCase() === BUYER.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
    out.buy = { ok: true, taxPct: pct(fromPool, bought > 0n ? bought : 0n) };
    if (bought <= 0n) { add("VANISHING_TOKEN", "deny", "The buy goes through, but the tokens do not stay in the buyer's wallet."); return finish(out); }
    taxFinding(add, "BUY", out.buy.taxPct);
  } catch (e) {
    add("SIM_UNAVAILABLE", "warn", `Could not simulate: ${(e as Error).message.split("\n")[0]}.`);
    return finish(out);
  }

  // Sell, transfer and backdoors, each after the same buy
  const sellAmount = bought;
  const approve = { from: BUYER, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [SWAP_ROUTER_02, maxUint256] }) };
  const sellData = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: token, tokenOut: WETH, fee: pool.fee, recipient: BUYER, amountIn: sellAmount, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] });
  const transferCall = { from: BUYER, to: token, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [STRANGER, sellAmount] }) };
  const [sellRes, transferRes, deep] = await Promise.all([
    sim(client, [buyCall, approve, { from: BUYER, to: SWAP_ROUTER_02, data: sellData }]).catch(() => null),
    sim(client, [buyCall, transferCall]).catch(() => null),
    probeReceivedToken(client, { chainId: 4663, from: BUYER, to: SWAP_ROUTER_02, data: buyData, value: BUY_WEI, overrides: { [BUYER]: { balance: toHex(10n ** 18n) } } }, token, sellAmount),
  ]);

  const s = sellRes?.[2];
  if (s) {
    if (s.status !== "0x1") {
      out.sell = { ok: false, taxPct: null, reason: decodeRevert(s.error?.data ?? s.returnData, s.error?.message) };
      add("HONEYPOT", "deny", `Buying works but selling reverts (${out.sell.reason}). This is a honeypot.`);
    } else {
      const tr = parseLogs(s.logs ?? []).transfers.filter((t) => t.asset.toLowerCase() === token.toLowerCase());
      const toPool = tr.filter((t) => t.to.toLowerCase() === pool.address.toLowerCase()).reduce((a, t) => a + t.amount, 0n);
      out.sell = { ok: true, taxPct: pct(sellAmount, toPool) };
      taxFinding(add, "SELL", out.sell.taxPct);
    }
  }
  const t = transferRes?.[1];
  if (t) {
    if (t.status !== "0x1") {
      out.transfer = { ok: false, taxPct: null, reason: decodeRevert(t.error?.data ?? t.returnData, t.error?.message) };
      add("TRANSFER_BLOCKED", "deny", `Tokens cannot be sent to another wallet after buying (${out.transfer.reason}).`);
    } else {
      const got = parseLogs(t.logs ?? []).transfers.filter((x) => x.asset.toLowerCase() === token.toLowerCase() && x.to.toLowerCase() === STRANGER.toLowerCase()).reduce((a, x) => a + x.amount, 0n);
      out.transfer = { ok: true, taxPct: pct(sellAmount, got) };
      taxFinding(add, "TRANSFER", out.transfer.taxPct);
    }
  }
  out.pullableBy = deep.pulledBy.map((a) => (a.toLowerCase() === STRANGER.toLowerCase() ? "anyone" : "owner"));
  if (out.pullableBy.length) add("ALLOWANCE_BYPASS", "deny", `${out.pullableBy.includes("anyone") ? "Anyone" : "The owner"} can take the tokens out of a holder's wallet without an approval: what you buy can be clawed back.`);
  return finish(out);
}

function taxFinding(add: (c: string, s: Finding["severity"], m: string) => void, kind: "BUY" | "SELL" | "TRANSFER", tax: number | null) {
  if (tax === null || tax < 0.5) return;
  const what = kind === "BUY" ? "buy" : kind === "SELL" ? "sell" : "transfer";
  add(`${kind}_TAX`, tax >= 50 ? "deny" : tax >= 10 ? "warn" : "info", `${tax.toFixed(1)}% tax on every ${what}.`);
}

function finish(out: TokenCheck): TokenCheck {
  const deny = out.findings.filter((f) => f.severity === "deny").length;
  const warn = out.findings.filter((f) => f.severity === "warn").length;
  out.verdict = deny ? "DENY" : warn ? "WARN" : "ALLOW";
  out.riskScore = deny ? Math.min(100, 85 + deny * 5 + warn * 2) : Math.min(80, warn * 25);
  return out;
}
