import {
  type Address, type Hex, type PublicClient,
  decodeErrorResult, encodeFunctionData, hexToBigInt, getAddress, parseAbi, toHex,
} from "viem";
import { NATIVE_ASSET } from "./chains.js";
import type { TxIntent } from "./types.js";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const APPROVAL_FOR_ALL_TOPIC = "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31";

export interface RawLog { address: Address; topics: Hex[]; data: Hex }

export interface SimTransfer {
  asset: Address;
  from: Address;
  to: Address;
  kind: "native" | "erc20" | "erc721";
  amount: bigint; // value, or tokenId for erc721
}

export interface SimApproval {
  token: Address;
  owner: Address;
  spender: Address;
  kind: "erc20" | "erc721-all";
  amount?: bigint;
  approved?: boolean;
}

export interface SimResult {
  available: boolean;
  ok: boolean;
  gasUsed?: bigint;
  revertReason?: string;
  transfers: SimTransfer[];
  approvals: SimApproval[];
  error?: string;
}

const topicAddr = (t: Hex) => getAddress(`0x${t.slice(26)}`);

export function parseLogs(logs: RawLog[]): { transfers: SimTransfer[]; approvals: SimApproval[] } {
  const transfers: SimTransfer[] = [];
  const approvals: SimApproval[] = [];
  for (const l of logs) {
    const t0 = l.topics[0]?.toLowerCase();
    const asset = getAddress(l.address);
    if (t0 === TRANSFER_TOPIC && l.topics.length >= 3) {
      const isNative = asset.toLowerCase() === NATIVE_ASSET.toLowerCase();
      if (l.topics.length === 4) {
        transfers.push({ asset, from: topicAddr(l.topics[1]!), to: topicAddr(l.topics[2]!), kind: "erc721", amount: hexToBigInt(l.topics[3]!) });
      } else {
        const amount = l.data && l.data !== "0x" ? hexToBigInt(l.data.slice(0, 66) as Hex) : 0n;
        transfers.push({ asset, from: topicAddr(l.topics[1]!), to: topicAddr(l.topics[2]!), kind: isNative ? "native" : "erc20", amount });
      }
    } else if (t0 === APPROVAL_TOPIC && l.topics.length === 3) {
      const amount = l.data && l.data !== "0x" ? hexToBigInt(l.data.slice(0, 66) as Hex) : 0n;
      approvals.push({ token: asset, owner: topicAddr(l.topics[1]!), spender: topicAddr(l.topics[2]!), kind: "erc20", amount });
    } else if (t0 === APPROVAL_FOR_ALL_TOPIC && l.topics.length === 3) {
      const approved = l.data !== "0x" && hexToBigInt(l.data) !== 0n;
      approvals.push({ token: asset, owner: topicAddr(l.topics[1]!), spender: topicAddr(l.topics[2]!), kind: "erc721-all", approved });
    }
  }
  return { transfers, approvals };
}

export function decodeRevert(data?: Hex, message?: string): string {
  if (data && data.length >= 10) {
    try {
      const r = decodeErrorResult({ abi: parseAbi(["error Error(string)", "error Panic(uint256)"]), data });
      return r.errorName === "Error" ? String(r.args[0]) : `Panic(${String(r.args[0])})`;
    } catch {
      return `custom error ${data.slice(0, 10)}`;
    }
  }
  return message ?? "execution reverted";
}

/** Simulate the intent against latest state with eth_simulateV1 + traceTransfers. */
export async function simulate(client: PublicClient, tx: TxIntent): Promise<SimResult> {
  const call: Record<string, unknown> = { from: tx.from, data: tx.data, value: toHex(tx.value) };
  if (tx.to) call.to = tx.to;
  let res: any;
  try {
    res = await client.request({
      method: "eth_simulateV1" as any,
      params: [{ blockStateCalls: [{ calls: [call], ...(tx.overrides ? { stateOverrides: tx.overrides } : {}) }], traceTransfers: true, validation: false }, "latest"] as any,
    });
  } catch (e) {
    return { available: false, ok: false, transfers: [], approvals: [], error: (e as Error).message?.split("\n")[0] };
  }
  const c = res?.[0]?.calls?.[0];
  if (!c) return { available: false, ok: false, transfers: [], approvals: [], error: "empty simulation result" };
  const ok = c.status === "0x1";
  const { transfers, approvals } = parseLogs((c.logs ?? []) as RawLog[]);
  return {
    available: true,
    ok,
    gasUsed: c.gasUsed ? hexToBigInt(c.gasUsed) : undefined,
    revertReason: ok ? undefined : decodeRevert(c.error?.data ?? c.returnData, c.error?.message),
    transfers,
    approvals,
  };
}

/** Address with no code used to test whether received tokens can be moved again. */
export const PROBE: Address = "0x5eeD5EED5eeD5EEd5eed5eEd5eEd5eed5EeD5EEd";
/** A stranger with no allowance: if it can pull tokens out of the agent's wallet, the token has a backdoor. */
export const STRANGER: Address = "0x5714a6E75714a6e75714a6E75714a6e75714A6E7";

export interface ProbeResult { token: Address; sent: bigint; received: bigint; ok: boolean; reason?: string }

/**
 * Re-run the transaction, then try to move each received token from the agent to an empty address.
 * Catches honeypots (tokens that cannot be moved) and fee-on-transfer taxes.
 */
export async function probeTransferability(client: PublicClient, tx: TxIntent, tokens: { token: Address; amount: bigint }[]): Promise<ProbeResult[]> {
  const main: Record<string, unknown> = { from: tx.from, data: tx.data, value: toHex(tx.value) };
  if (tx.to) main.to = tx.to;
  const ERC20T = parseAbi(["function transfer(address,uint256) returns (bool)"]);
  const probes = tokens.map((t) => ({ from: tx.from, to: t.token, data: encodeFunctionData({ abi: ERC20T, functionName: "transfer", args: [PROBE, t.amount] }) }));
  let res: any;
  try {
    res = await client.request({
      method: "eth_simulateV1" as any,
      params: [{ blockStateCalls: [{ calls: [main, ...probes], ...(tx.overrides ? { stateOverrides: tx.overrides } : {}) }], traceTransfers: true, validation: false }, "latest"] as any,
    });
  } catch {
    return [];
  }
  const calls = res?.[0]?.calls ?? [];
  return tokens.map((t, i) => {
    const c = calls[i + 1];
    if (!c) return { token: t.token, sent: t.amount, received: 0n, ok: false, reason: "no result" };
    if (c.status !== "0x1") return { token: t.token, sent: t.amount, received: 0n, ok: false, reason: decodeRevert(c.error?.data ?? c.returnData, c.error?.message) };
    const { transfers } = parseLogs((c.logs ?? []) as RawLog[]);
    const received = transfers.filter((x) => x.asset.toLowerCase() === t.token.toLowerCase() && x.to.toLowerCase() === PROBE.toLowerCase()).reduce((a, x) => a + x.amount, 0n);
    return { token: t.token, sent: t.amount, received, ok: true };
  });
}

const ERC20X = parseAbi([
  "function transfer(address,uint256) returns (bool)",
  "function transferFrom(address,address,uint256) returns (bool)",
]);

// owner() rarely changes: cached per client for 10 minutes (null = no owner function or renounced).
const owners = new WeakMap<PublicClient, Map<string, { at: number; owner: Address | null }>>();
async function ownerOf(client: PublicClient, token: Address): Promise<Address | null> {
  let m = owners.get(client);
  if (!m) owners.set(client, (m = new Map()));
  const hit = m.get(token.toLowerCase());
  if (hit && Date.now() - hit.at < 600_000) return hit.owner;
  const o = await client.readContract({ address: token, abi: parseAbi(["function owner() view returns (address)"]), functionName: "owner" }).catch(() => null) as Address | null;
  const owner = o && !/^0x0{40}$/i.test(o) ? o : null;
  if (m.size > 5_000) m.delete(m.keys().next().value!);
  m.set(token.toLowerCase(), { at: Date.now(), owner });
  return owner;
}

/** Run the transaction, then one more call in the same block; returns that call's outcome and transfers. */
async function afterMain(client: PublicClient, tx: TxIntent, call: { from: Address; to: Address; data: Hex }) {
  const main: Record<string, unknown> = { from: tx.from, data: tx.data, value: toHex(tx.value) };
  if (tx.to) main.to = tx.to;
  try {
    const res: any = await client.request({
      method: "eth_simulateV1" as any,
      params: [{ blockStateCalls: [{ calls: [main, call], ...(tx.overrides ? { stateOverrides: tx.overrides } : {}) }], traceTransfers: true, validation: false }, "latest"] as any,
    });
    const c = res?.[0]?.calls?.[1];
    if (!c) return null;
    const ok = c.status === "0x1";
    return { ok, reason: ok ? undefined : decodeRevert(c.error?.data ?? c.returnData, c.error?.message), transfers: parseLogs((c.logs ?? []) as RawLog[]).transfers };
  } catch {
    return null;
  }
}

export interface TokenProbe {
  token: Address;
  amount: bigint;
  /** Selling: sending the tokens back to where they came from (the pool). */
  sell?: { ok: boolean; reason?: string; received: bigint; to: Address };
  /** Who could pull the tokens out of the agent's wallet without an approval (the hidden-allowance backdoor). */
  pulledBy: Address[];
}

/**
 * For a token the agent is about to receive: can it be sold back to its source, and can a stranger or the token's
 * owner take it out of the wallet without any approval? Each question is its own simulation, after the real call.
 */
export async function probeReceivedToken(client: PublicClient, tx: TxIntent, token: Address, amount: bigint, source?: Address): Promise<TokenProbe> {
  const out: TokenProbe = { token, amount, pulledBy: [] };
  const pull = (who: Address) => afterMain(client, tx, { from: who, to: token, data: encodeFunctionData({ abi: ERC20X, functionName: "transferFrom", args: [tx.from, who, amount] }) });
  // The sell, the stranger's pull and the owner lookup run at once; only a token with an owner costs one more round trip.
  const [sell, strangerPull, owner] = await Promise.all([
    source && source.toLowerCase() !== tx.from.toLowerCase()
      ? afterMain(client, tx, { from: tx.from, to: token, data: encodeFunctionData({ abi: ERC20X, functionName: "transfer", args: [source, amount] }) })
      : Promise.resolve(null),
    pull(STRANGER),
    ownerOf(client, token),
  ]);
  const ownerPull = owner && owner.toLowerCase() !== tx.from.toLowerCase() ? await pull(owner) : null;
  const pulls: [Address, Awaited<ReturnType<typeof pull>>][] = [[STRANGER, strangerPull], ...(owner && ownerPull !== null ? [[owner, ownerPull] as [Address, Awaited<ReturnType<typeof pull>>]] : [])];
  if (sell && source) {
    const received = sell.transfers.filter((x) => x.asset.toLowerCase() === token.toLowerCase() && x.to.toLowerCase() === source.toLowerCase()).reduce((a, x) => a + x.amount, 0n);
    out.sell = { ok: sell.ok, reason: sell.reason, received, to: source };
  }
  for (const [who, p] of pulls) {
    // a real pull moves the agent's tokens; "returns false" without a transfer is not a backdoor
    if (p?.ok && p.transfers.some((x) => x.asset.toLowerCase() === token.toLowerCase() && x.from.toLowerCase() === tx.from.toLowerCase())) out.pulledBy.push(who);
  }
  return out;
}
