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
      params: [{ blockStateCalls: [{ calls: [call] }], traceTransfers: true, validation: false }, "latest"] as any,
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
      params: [{ blockStateCalls: [{ calls: [main, ...probes] }], traceTransfers: true, validation: false }, "latest"] as any,
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
