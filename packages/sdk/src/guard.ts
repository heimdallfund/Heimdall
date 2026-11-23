import { type Address, type Chain, encodeFunctionData, type Hex, maxUint64, parseAbi, type PublicClient, type WalletClient } from "viem";
import { heimdallGuardModuleAbi, heimdallRiskOracleAbi } from "./abi.js";
import { HeimdallDenied, HeimdallError, type HeimdallShield, type Policy, receiptArgs, type CheckResult } from "./index.js";

// ───────────────────────────── Heimdall Guard (Safe module) ─────────────────────────────

export interface GuardSetup {
  module: Address;
  agent: Address;
  /** Wei the agent may send per 24 h (0 = no ETH). */
  ethPerDay?: bigint;
  /** Tokens the agent may move, with a 24 h limit in raw units. Approvals count against the limit. */
  tokens?: { token: Address; perDay: bigint }[];
  /** Contracts the agent may call besides the listed tokens (only enforced with `strictTargets`). */
  targets?: Address[];
  strictTokens?: boolean;
  strictTargets?: boolean;
  /** Unix seconds; 0 or unset = no expiry. */
  expiresAt?: bigint;
}

export interface SafeCall { to: Address; value: string; data: Hex }

const SAFE = parseAbi(["function enableModule(address module)"]);

/** The Safe transactions that enable the module and give one agent its limits. Execute them from the Safe. */
export function guardSetupCalls(safe: Address, s: GuardSetup): SafeCall[] {
  const call = (data: Hex, to: Address = s.module): SafeCall => ({ to, value: "0", data });
  const calls: SafeCall[] = [
    call(encodeFunctionData({ abi: SAFE, functionName: "enableModule", args: [s.module] }), safe),
    call(encodeFunctionData({ abi: heimdallGuardModuleAbi, functionName: "setPolicy", args: [s.ethPerDay ?? 0n, !!s.strictTokens, !!s.strictTargets] })),
    call(encodeFunctionData({ abi: heimdallGuardModuleAbi, functionName: "setAgent", args: [s.agent, true, s.expiresAt ?? 0n] })),
  ];
  for (const t of s.tokens ?? []) calls.push(call(encodeFunctionData({ abi: heimdallGuardModuleAbi, functionName: "setTokenLimit", args: [t.token, t.perDay, true] })));
  for (const t of s.targets ?? []) calls.push(call(encodeFunctionData({ abi: heimdallGuardModuleAbi, functionName: "setTarget", args: [t, true] })));
  if ((s.expiresAt ?? 0n) > maxUint64) throw new HeimdallError("expiresAt does not fit in uint64");
  return calls;
}

/** Safe Transaction Builder file (import it in app.safe.global → Transaction Builder). */
export function safeBatch(chainId: number, safe: Address, calls: SafeCall[], name = "Heimdall Guard setup") {
  return {
    version: "1.0",
    chainId: String(chainId),
    createdAt: Date.now(),
    meta: { name, description: `Enable the Heimdall Guard module on ${safe} and set the agent's limits` },
    transactions: calls,
  };
}

/**
 * Agent side: ask Shield about the call *as the Safe* (the account that will execute it), then run it through the
 * module. Throws HeimdallDenied on WARN or DENY, so nothing reaches the chain.
 */
export async function executeThroughGuard(
  wallet: WalletClient,
  params: { module: Address; safe: Address; to: Address; data?: Hex; value?: bigint; chain?: Chain },
  opts: { shield: HeimdallShield; policy?: Policy },
): Promise<{ hash: Hex; result: CheckResult }> {
  const account = wallet.account;
  if (!account) throw new HeimdallError("wallet has no account");
  const chain = params.chain ?? wallet.chain;
  const data = params.data ?? "0x";
  const value = params.value ?? 0n;
  const result = await opts.shield.check({ chainId: chain?.id ?? 4663, from: params.safe, to: params.to, data, value }, opts.policy);
  if (result.verdict !== "ALLOW" || !result.receipt) throw new HeimdallDenied(result);
  const { receipt, signature } = receiptArgs(result.receipt);
  const hash = await wallet.writeContract({
    account, chain, address: params.module, abi: heimdallGuardModuleAbi, functionName: "execute",
    args: [params.safe, params.to, value, data, receipt, signature],
  });
  return { hash, result };
}

/** What the agent can still spend today (asset = token address, or undefined for ETH). */
export async function guardRemaining(client: PublicClient, module: Address, safe: Address, asset?: Address): Promise<bigint> {
  return client.readContract({ address: module, abi: heimdallGuardModuleAbi, functionName: "remaining", args: [safe, asset ?? "0x0000000000000000000000000000000000000000"] });
}

// ───────────────────────────── Risk Oracle ─────────────────────────────

export const RISK_LEVEL = ["none", "low", "warn", "blocked"] as const;
export const RISK_FLAGS = ["drainer", "phishing", "honeypot", "malicious_contract", "scam_token", "exploiter", "community", "shield_denied"] as const;

export interface OnchainRisk { level: number; levelName: (typeof RISK_LEVEL)[number]; flags: string[]; updatedAt: number; blocked: boolean }

/** Read the Heimdall Risk Oracle onchain (free, no API key). */
export async function readRisk(client: PublicClient, oracle: Address, account: Address): Promise<OnchainRisk> {
  const [level, flags, updatedAt] = await client.readContract({ address: oracle, abi: heimdallRiskOracleAbi, functionName: "riskOf", args: [account] });
  return {
    level,
    levelName: RISK_LEVEL[level] ?? "blocked",
    flags: RISK_FLAGS.filter((_, i) => (flags & (1 << i)) !== 0),
    updatedAt: Number(updatedAt),
    blocked: level >= 3,
  };
}

// ───────────────────────────── ERC-8004: Heimdall Score onchain ─────────────────────────────

export const ERC8004_REGISTRIES = {
  identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address,
  reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as Address,
};

const REPUTATION_ABI = parseAbi(["function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)"]);

/**
 * Read Heimdall's score for an ERC-8004 agent straight from the Reputation Registry (no API). `publisher` is Heimdall's
 * publishing address, from GET /v1/passport/<id> (`publisher`) or the docs.
 */
export async function heimdallScore(client: PublicClient, agentId: bigint, publisher: Address, registry: Address = ERC8004_REGISTRIES.reputation) {
  const [count, value, decimals] = await client.readContract({ address: registry, abi: REPUTATION_ABI, functionName: "getSummary", args: [agentId, [publisher], "heimdall", ""] });
  return { count: Number(count), score: count ? Number(value) / 10 ** decimals : null };
}
