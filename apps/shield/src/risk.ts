import { getAddress, isAddress, parseAbi, type PublicClient } from "viem";
import { blocklistEntries, type BlocklistEntry } from "./blocklist.js";

/**
 * Risk data for the Heimdall Risk Oracle: what Shield knows about an address, as the level and flag bits the onchain
 * oracle stores (see contracts/contracts/interfaces/IHeimdallRisk.sol). The monitor's `riskSync` job writes this list
 * onchain; `/v1/risk/:address` answers offchain with the same numbers, plus what the oracle holds right now.
 */

export const LEVEL = { NONE: 0, LOW: 1, WARN: 2, BLOCKED: 3 } as const;
export const LEVEL_NAME = ["none", "low", "warn", "blocked"] as const;

export const FLAG = {
  DRAINER: 1 << 0,
  PHISHING: 1 << 1,
  HONEYPOT: 1 << 2,
  MALICIOUS_CONTRACT: 1 << 3,
  SCAM_TOKEN: 1 << 4,
  EXPLOITER: 1 << 5,
  COMMUNITY: 1 << 6,
  SHIELD_DENIED: 1 << 7,
} as const;

export function flagNames(bits: number): string[] {
  return Object.entries(FLAG).filter(([, b]) => (bits & b) !== 0).map(([k]) => k.toLowerCase());
}

/** A target Shield denied this many times in the Threat Board window becomes a WARN entry. */
export const DENY_THRESHOLD = 5;

export interface RiskEntry { address: `0x${string}`; level: number; flags: number; source: string; label?: string }

/** Flag bits from a curated label ("Inferno drainer", "Phishing: fake airdrop", "Honeypot token", …). */
export function flagsFromLabel(e: BlocklistEntry): number {
  const t = `${e.label ?? ""} ${e.source ?? ""}`.toLowerCase();
  let f = 0;
  if (/drain/.test(t)) f |= FLAG.DRAINER;
  if (/phish|fake|impersonat/.test(t)) f |= FLAG.PHISHING;
  if (/honeypot|cannot be sold|can't sell/.test(t)) f |= FLAG.HONEYPOT;
  if (/backdoor|malicious contract|hidden/.test(t)) f |= FLAG.MALICIOUS_CONTRACT;
  if (/scam token|fake token|copycat/.test(t)) f |= FLAG.SCAM_TOKEN;
  if (/exploit|hack/.test(t)) f |= FLAG.EXPLOITER;
  if (/community|guardian report/.test(t)) f |= FLAG.COMMUNITY | (f === 0 ? FLAG.DRAINER : 0);
  return f || FLAG.MALICIOUS_CONTRACT;
}

/** Everything that should be onchain right now. Blocklist entries win over Threat Board counts. */
export function buildRiskList(blocklist: BlocklistEntry[], denied: { address: string; denies: number }[]): RiskEntry[] {
  const out = new Map<string, RiskEntry>();
  for (const e of blocklist) {
    if (!isAddress(e.address)) continue;
    out.set(e.address.toLowerCase(), { address: getAddress(e.address), level: LEVEL.BLOCKED, flags: flagsFromLabel(e), source: e.source ?? "blocklist", label: e.label });
  }
  for (const t of denied) {
    if (!isAddress(t.address) || t.denies < DENY_THRESHOLD) continue;
    const k = t.address.toLowerCase();
    const prev = out.get(k);
    if (prev) prev.flags |= FLAG.SHIELD_DENIED;
    else out.set(k, { address: getAddress(t.address), level: LEVEL.WARN, flags: FLAG.SHIELD_DENIED, source: "shield", label: `Denied by Shield ${t.denies} times this week` });
  }
  return [...out.values()].sort((a, b) => b.level - a.level || a.address.localeCompare(b.address));
}

export function riskList(denied: { address: string; denies: number }[]): RiskEntry[] {
  return buildRiskList(blocklistEntries(), denied);
}

const ORACLE_ABI = parseAbi(["function riskOf(address) view returns (uint8 level, uint32 flags, uint64 updatedAt)"]);

/** What the onchain oracle holds for `address`, or null when no oracle is configured or it cannot be read. */
export async function readOracle(client: PublicClient, oracle: string | undefined, address: `0x${string}`) {
  if (!oracle || !isAddress(oracle)) return null;
  try {
    const [level, flags, updatedAt] = await client.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "riskOf", args: [address] });
    return { level, flags, flagNames: flagNames(flags), updatedAt: updatedAt ? new Date(Number(updatedAt) * 1000).toISOString() : null };
  } catch {
    return null;
  }
}

export function describe(entry: RiskEntry | undefined, address: `0x${string}`) {
  const level = entry?.level ?? LEVEL.NONE;
  return {
    address,
    level,
    levelName: LEVEL_NAME[level],
    flags: entry?.flags ?? 0,
    flagNames: flagNames(entry?.flags ?? 0),
    label: entry?.label ?? null,
    source: entry?.source ?? null,
    blocked: level >= LEVEL.BLOCKED,
  };
}
