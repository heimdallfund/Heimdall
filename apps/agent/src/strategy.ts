import type { Address } from "viem";

/**
 * "Guardian Balanced" — a deliberately simple, explainable strategy:
 * hold a target basket of stock tokens plus a USDG cash buffer, rebalance when weights drift past a band,
 * and let signals veto risk: exit tokens rated high/critical risk, never add to a token trading at a premium
 * above its exchange price, and lean in (up to +10%) when it trades at a discount.
 */
export interface Holding {
  token: Address;
  symbol: string;
  decimals: number;
  amount: bigint; // token units
  value: bigint; // USDG units (6 decimals)
  price: bigint; // USDG units per 1 whole token
}

export interface Signals {
  risk?: Record<string, "low" | "medium" | "high" | "critical">; // by token address (lower case)
  premiumBps?: Record<string, number>; // by token address (lower case)
}

export interface PlanInput {
  usdg: Address;
  usdgBalance: bigint;
  holdings: Holding[];
  targetsBps: Record<string, number>; // token (lower case) → weight of NAV in bps; the rest is cash
  bandBps: number; // rebalance only if |drift| > band
  maxTradeBps: number; // the vault's onchain limit
  slippageBps: number;
  signals?: Signals;
}

export interface Order {
  side: "buy" | "sell";
  token: Address;
  symbol: string;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  expectedOut: bigint;
  minOut: bigint;
  reason: string;
}

const BPS = 10_000n;
const PREMIUM_LIMIT = 200; // 2%

export function nav(input: PlanInput): bigint {
  return input.usdgBalance + input.holdings.reduce((a, h) => a + h.value, 0n);
}

export function adjustedTargets(input: PlanInput): Record<string, { bps: number; why: string }> {
  const out: Record<string, { bps: number; why: string }> = {};
  const total = nav(input);
  for (const h of input.holdings) {
    const k = h.token.toLowerCase();
    let bps = input.targetsBps[k] ?? 0;
    let why = `target ${bps / 100}%`;
    const risk = input.signals?.risk?.[k];
    const prem = input.signals?.premiumBps?.[k];
    const currentBps = total > 0n ? Number((h.value * BPS) / total) : 0;
    if (risk === "high" || risk === "critical") { bps = 0; why = `exit: token risk ${risk}`; }
    else if (prem !== undefined && prem > PREMIUM_LIMIT && bps > currentBps) { bps = currentBps; why = `hold: trades ${prem / 100}% above exchange price`; }
    else if (prem !== undefined && prem < -PREMIUM_LIMIT && bps > 0) { bps = Math.round(bps * 1.1); why = `lean in: ${-prem / 100}% below exchange price`; }
    out[k] = { bps, why };
  }
  return out;
}

export function plan(input: PlanInput): Order[] {
  const total = nav(input);
  if (total === 0n) return [];
  const targets = adjustedTargets(input);
  const band = (total * BigInt(input.bandBps)) / BPS;
  const maxTrade = (total * BigInt(input.maxTradeBps) * 95n) / (BPS * 100n); // 5% margin under the onchain limit
  const slip = (v: bigint) => (v * (BPS - BigInt(input.slippageBps))) / BPS;

  const sells: Order[] = [];
  const buys: Order[] = [];
  for (const h of input.holdings) {
    const t = targets[h.token.toLowerCase()]!;
    const targetValue = (total * BigInt(t.bps)) / BPS;
    const diff = targetValue - h.value;
    if ((diff < 0n ? -diff : diff) <= band || h.price === 0n) continue;
    const one = 10n ** BigInt(h.decimals);
    if (diff < 0n) {
      const valueOut = -diff > maxTrade ? maxTrade : -diff;
      const amountIn = (valueOut * one) / h.price;
      sells.push({ side: "sell", token: h.token, symbol: h.symbol, tokenIn: h.token, tokenOut: input.usdg, amountIn, expectedOut: valueOut, minOut: slip(valueOut), reason: t.why });
    } else {
      const valueIn = diff > maxTrade ? maxTrade : diff;
      const expectedOut = (valueIn * one) / h.price;
      buys.push({ side: "buy", token: h.token, symbol: h.symbol, tokenIn: input.usdg, tokenOut: h.token, amountIn: valueIn, expectedOut, minOut: slip(expectedOut), reason: t.why });
    }
  }
  // buys are funded by cash plus what the sells free up
  let cash = input.usdgBalance + sells.reduce((a, s) => a + s.minOut, 0n);
  const funded: Order[] = [];
  for (const b of buys.sort((a, z) => (z.amountIn > a.amountIn ? 1 : -1))) {
    if (cash <= 0n) break;
    if (b.amountIn > cash) {
      const ratio = (cash * BPS) / b.amountIn;
      b.expectedOut = (b.expectedOut * ratio) / BPS;
      b.minOut = (b.minOut * ratio) / BPS;
      b.amountIn = cash;
    }
    cash -= b.amountIn;
    if (b.amountIn > 0n) funded.push(b);
  }
  return [...sells, ...funded];
}
