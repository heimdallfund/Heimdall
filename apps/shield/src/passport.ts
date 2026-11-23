import { getAddress, isAddress, keccak256, parseAbi, toHex, type Address, type PublicClient } from "viem";
import type { CounterStore } from "./store.js";

/**
 * Agent Passport: one trust record per agent, built from what Heimdall can verify, and tied to the agent's ERC-8004
 * identity on Robinhood Chain.
 *
 *  - Heimdall Score (0–100) from: Shield history (how often its transactions were denied), Heimdall Pay record
 *    (completed vs disputed jobs, onchain), the Risk Oracle (a blocked address scores 0), and track record length.
 *  - ERC-8004: the official Identity and Reputation registries are deployed on Robinhood Chain at the standard
 *    addresses. A Passport links an agentId to a wallet after checking ownership onchain, and the monitor publishes
 *    the score as Heimdall's feedback (tag1 "heimdall"), so any contract or agent can read it with getSummary().
 */

export const ERC8004 = {
  identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address,
  reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as Address,
};

export const IDENTITY_ABI = parseAbi([
  "function ownerOf(uint256 agentId) view returns (address)",
  "function tokenURI(uint256 agentId) view returns (string)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
]);
export const REPUTATION_ABI = parseAbi([
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
]);
const PAY_ABI = parseAbi([
  "function completedOf(address) view returns (uint256)",
  "function disputedOf(address) view returns (uint256)",
  "function earnedOf(address) view returns (uint256)",
]);

export interface ScoreInputs {
  shield: { checks: number; allowed: number; warned: number; denied: number; firstSeen: number | null };
  pay: { completed: number; disputed: number; earnedUsdg: number } | null;
  riskLevel: number; // 0..3 from the Risk Oracle / Shield list
  txCount: number | null; // onchain nonce, for accounts with no Heimdall history
  now?: number;
}

export interface Component { name: "shield" | "pay" | "history"; score: number; weight: number; detail: string }

export interface Score {
  score: number | null;
  tier: "A" | "B" | "C" | "D" | "new" | "blocked";
  components: Component[];
  capped?: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Pure scoring: same inputs, same score. Components without enough data are left out, never guessed. */
export function scorePassport(i: ScoreInputs): Score {
  const comps: Component[] = [];
  const s = i.shield;
  if (s.checks >= 5) {
    const denyRate = s.denied / s.checks;
    const warnRate = s.warned / s.checks;
    // a careful agent almost never hits DENY; WARNs cost a little
    comps.push({ name: "shield", score: clamp(100 - denyRate * 300 - warnRate * 40), weight: 45, detail: `${s.checks} checks, ${s.denied} denied, ${s.warned} warned` });
  }
  if (i.pay && i.pay.completed + i.pay.disputed > 0) {
    const jobs = i.pay.completed + i.pay.disputed;
    const reliability = i.pay.completed / jobs;
    // squared, so disputes hurt fast (50% disputed → 25); confidence grows with volume: 20+ jobs count fully
    const confidence = Math.min(1, jobs / 20);
    comps.push({ name: "pay", score: clamp(50 + (reliability * reliability * 100 - 50) * confidence), weight: 40, detail: `${i.pay.completed} jobs completed, ${i.pay.disputed} disputed, ${i.pay.earnedUsdg.toFixed(2)} USDG earned` });
  }
  const now = i.now ?? Date.now();
  const days = s.firstSeen ? (now - s.firstSeen) / 86_400_000 : 0;
  if (days > 0 || (i.txCount ?? 0) > 0) {
    const fromDays = Math.min(100, days * (100 / 90)); // 90 days of history = full marks
    const fromTx = Math.min(100, Math.log10(1 + (i.txCount ?? 0)) * 40); // ~300 transactions = full marks
    // a small weight: age can support a good record, never hide a bad one
    comps.push({ name: "history", score: clamp(Math.max(fromDays, fromTx)), weight: 15, detail: `${Math.floor(days)} days with Heimdall, ${i.txCount ?? 0} transactions onchain` });
  }
  if (i.riskLevel >= 3) return { score: 0, tier: "blocked", components: comps, capped: "On Heimdall's blocklist" };
  if (!comps.some((c) => c.name !== "history")) return { score: null, tier: "new", components: comps };
  const w = comps.reduce((a, c) => a + c.weight, 0);
  let score = clamp(comps.reduce((a, c) => a + c.score * c.weight, 0) / w);
  let capped: string | undefined;
  if (i.riskLevel === 2 && score > 40) { score = 40; capped = "Flagged by Shield: recent denied transactions to this address"; }
  const tier = score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";
  return { score, tier, components: comps, capped };
}

// ── ERC-8004 identity ────────────────────────────────────────────────────────

export interface Registration { name?: string; description?: string; image?: string; services?: { name: string; endpoint: string; version?: string }[]; x402Support?: boolean; active?: boolean }

/** Read an agent registration file: data: URI, or https with a size and time cap. Never throws. */
export async function readRegistration(uri: string, fetcher: typeof fetch = fetch): Promise<Registration | null> {
  try {
    if (uri.startsWith("data:")) {
      const [meta, body] = uri.slice(5).split(",", 2);
      const text = meta.endsWith(";base64") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body);
      return pick(JSON.parse(text));
    }
    const url = uri.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${uri.slice(7)}` : uri;
    if (!/^https:\/\//.test(url)) return null;
    const res = await fetcher(url, { signal: AbortSignal.timeout(4000), redirect: "follow" });
    if (!res.ok || Number(res.headers.get("content-length") ?? 0) > 64_000) return null;
    const text = await res.text();
    return text.length > 64_000 ? null : pick(JSON.parse(text));
  } catch {
    return null;
  }
}

function pick(j: Record<string, unknown>): Registration {
  const str = (v: unknown, n = 300) => (typeof v === "string" ? v.slice(0, n) : undefined);
  const services = Array.isArray(j.services ?? j.endpoints)
    ? ((j.services ?? j.endpoints) as Record<string, unknown>[]).slice(0, 12).map((s) => ({ name: str(s.name, 40) ?? "service", endpoint: str(s.endpoint, 300) ?? "", version: str(s.version, 20) })).filter((s) => s.endpoint)
    : undefined;
  return { name: str(j.name, 80), description: str(j.description, 500), image: str(j.image), services, x402Support: typeof j.x402Support === "boolean" ? j.x402Support : undefined, active: typeof j.active === "boolean" ? j.active : undefined };
}

export interface Identity { agentId: string; owner: Address; wallet: Address | null; uri: string | null; registration: Registration | null; registry: string }

export async function readIdentity(client: PublicClient, agentId: bigint, fetcher: typeof fetch = fetch, registry = ERC8004.identity): Promise<Identity | null> {
  try {
    const owner = await client.readContract({ address: registry, abi: IDENTITY_ABI, functionName: "ownerOf", args: [agentId] });
    const [wallet, uri] = await Promise.all([
      client.readContract({ address: registry, abi: IDENTITY_ABI, functionName: "getAgentWallet", args: [agentId] }).catch(() => null),
      client.readContract({ address: registry, abi: IDENTITY_ABI, functionName: "tokenURI", args: [agentId] }).catch(() => null),
    ]);
    return {
      agentId: agentId.toString(), owner: getAddress(owner),
      wallet: wallet && wallet !== "0x0000000000000000000000000000000000000000" ? getAddress(wallet) : null,
      uri: uri ?? null, registration: uri ? await readRegistration(uri, fetcher) : null,
      registry: `eip155:${client.chain?.id ?? 4663}:${registry}`,
    };
  } catch {
    return null;
  }
}

/** Link agentId ↔ wallet after checking onchain that the wallet is the agent's owner or its registered agentWallet. */
export async function linkIdentity(store: CounterStore, client: PublicClient, address: Address, agentId: bigint, registry = ERC8004.identity): Promise<{ ok: true; identity: Identity } | { ok: false; reason: string }> {
  const id = await readIdentity(client, agentId, fetch, registry);
  if (!id) return { ok: false, reason: "agent_not_found" };
  const a = address.toLowerCase();
  if (id.owner.toLowerCase() !== a && id.wallet?.toLowerCase() !== a) return { ok: false, reason: "not_owner_or_agent_wallet" };
  await store.put(`passport:id:${a}`, id.agentId);
  await store.put(`passport:addr:${id.agentId}`, a);
  await store.addMember("passport:linked", a);
  return { ok: true, identity: id };
}

export async function linkedAgentId(store: CounterStore, address: string): Promise<bigint | null> {
  const v = await store.fetch(`passport:id:${address.toLowerCase()}`).catch(() => null);
  return v ? BigInt(v) : null;
}
export async function linkedAddress(store: CounterStore, agentId: bigint): Promise<Address | null> {
  const v = await store.fetch(`passport:addr:${agentId}`).catch(() => null);
  return v && isAddress(v) ? getAddress(v) : null;
}

/** Heimdall's own feedback on the official Reputation Registry (count and average), when a publisher is configured. */
export async function onchainReputation(client: PublicClient, agentId: bigint, publisher: string | undefined, registry = ERC8004.reputation) {
  if (!publisher || !isAddress(publisher)) return null;
  try {
    const [count, value, decimals] = await client.readContract({ address: registry, abi: REPUTATION_ABI, functionName: "getSummary", args: [agentId, [getAddress(publisher)], "heimdall", ""] });
    return { count: Number(count), average: count ? Number(value) / 10 ** decimals : null, publisher: getAddress(publisher), registry };
  } catch {
    return null;
  }
}

export async function payRecord(client: PublicClient, pay: string | undefined, address: Address) {
  if (!pay || !isAddress(pay)) return null;
  try {
    const [completed, disputed, earned] = await Promise.all((["completedOf", "disputedOf", "earnedOf"] as const).map((fn) => client.readContract({ address: pay, abi: PAY_ABI, functionName: fn, args: [address] })));
    return { completed: Number(completed), disputed: Number(disputed), earnedUsdg: Number(earned) / 1e6 };
  } catch {
    return null;
  }
}

// ── feedback files (ERC-8004 off-chain feedback, served at a stable URL) ─────

export function feedbackFile(o: { agentId: string; publisher: Address; chainId: number; score: number; tier: string; address: Address; components: Component[]; at?: number }) {
  return {
    agentRegistry: `eip155:${o.chainId}:${ERC8004.identity}`,
    agentId: Number(o.agentId),
    clientAddress: `eip155:${o.chainId}:${o.publisher}`,
    createdAt: new Date(o.at ?? Date.now()).toISOString(),
    value: o.score,
    valueDecimals: 0,
    tag1: "heimdall",
    tag2: o.tier,
    endpoint: `https://heimdall.fund/agent/${o.address}`,
    heimdall: { wallet: o.address, components: o.components.map((c) => ({ name: c.name, score: c.score, weight: c.weight, detail: c.detail })) },
  };
}

export const feedbackHash = (file: unknown) => keccak256(toHex(JSON.stringify(file)));
