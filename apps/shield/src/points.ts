import { type Address, type Hex, type PublicClient, getAddress, parseAbi, parseEventLogs } from "viem";
import type { CounterStore } from "./store.js";
import { PERMIT2 } from "./registry.js";

/**
 * Guardian Points, season 1. Every point comes from something checkable:
 *  - revoking a risky approval that Wallet Check flagged (verified from the transaction receipt);
 *  - a drainer report that a reviewer confirms (the address joins the community blocklist);
 *  - holding USDG in Heimdall vaults (daily snapshot computed from chain data by the monitor);
 *  - Shield checks made with your own API key (agents that actually use the firewall).
 * Points are an offchain record of participation. They are not a token and carry no promise of value.
 */

export const RULES = {
  revoke: 50,            // per risky approval revoked (once per token + spender)
  report: 200,           // per confirmed drainer report
  depositPer100Usd: 1,   // per 100 USDG held in vaults, per daily snapshot
  checksPerPoint: 100,   // Shield checks per point with your API key
  checkPointsDailyCap: 50,
  revokeDailyCap: 5,     // revokes that earn points per wallet per day…
  revokeSeasonCap: 25,   // …and per season: approving a throwaway spender to revoke it is not safety work
  early: 100,            // early access, once per wallet with onchain history
  referral: 100,         // to the inviter, when an invited wallet first uses a product for real
  welcome: 25,           // to the invited wallet at that moment
  referralCap: 25,       // qualified invites that earn points, per wallet per season
  stake: 25,             // first stake of at least 1,000 $HEIM
  pay: 25,               // first Heimdall Pay job of at least 10 USDG
} as const;

const FOREVER = 10 * 365 * 86_400;
const w = (a: string) => a.toLowerCase();
export type Reason = "revoke" | "report" | "deposit" | "checks" | "early" | "referral" | "action";
export interface PointsEvent { at: number; reason: Reason; points: number; ref?: string }

/** Adds points once per `dedupe` key. Returns the points awarded (0 when already counted). */
export async function award(store: CounterStore, wallet: string, reason: Reason, points: number, dedupe?: string, ref?: string, now = Date.now()): Promise<number> {
  if (points <= 0) return 0;
  if (dedupe) {
    const k = `points:once:${dedupe}`;
    if (await store.fetch(k)) return 0;
    await store.put(k, "1", FOREVER);
  }
  await store.incr(`points:${w(wallet)}`, FOREVER, points);
  await store.incr(`points:${w(wallet)}:${reason}`, FOREVER, points);
  await store.addMember("points:wallets", w(wallet));
  const logKey = `points:${w(wallet)}:log`;
  const log = JSON.parse((await store.fetch(logKey)) ?? "[]") as PointsEvent[];
  log.unshift({ at: now, reason, points, ref });
  await store.put(logKey, JSON.stringify(log.slice(0, 25)), FOREVER);
  await store.remove("points:board"); // leaderboard cache
  if (QUALIFYING.has(reason)) await onQualified?.(store, wallet);
  return points;
}

/** Real product use that makes an invited wallet count for its inviter (revokes and checks can be farmed, so they don't). */
const QUALIFYING = new Set<Reason>(["report", "deposit", "action"]);
let onQualified: ((store: CounterStore, wallet: string) => Promise<void>) | undefined;
/** Set by growth.ts, so points.ts does not import it (no cycle). */
export function setQualifiedHook(fn: typeof onQualified) { onQualified = fn; }

export async function walletPoints(store: CounterStore, wallet: string) {
  const [total, revoke, report, deposit, checks, early, referral, action] = await Promise.all(["", ":revoke", ":report", ":deposit", ":checks", ":early", ":referral", ":action"].map((s) => store.get(`points:${w(wallet)}${s}`)));
  const log = JSON.parse((await store.fetch(`points:${w(wallet)}:log`)) ?? "[]") as PointsEvent[];
  const board = await leaderboard(store);
  const rank = board.findIndex((r) => r.address === w(wallet));
  return { address: wallet, total, breakdown: { revoke, report, deposit, checks, early, referral, action }, rank: rank >= 0 ? rank + 1 : null, log };
}

export async function leaderboard(store: CounterStore, limit = 100) {
  const cached = await store.fetch("points:board");
  if (cached) return (JSON.parse(cached) as { address: string; total: number }[]).slice(0, limit);
  const wallets = await store.members("points:wallets");
  const rows = (await Promise.all(wallets.map(async (a) => ({ address: a, total: await store.get(`points:${a}`) }))))
    .filter((r) => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 500);
  await store.put("points:board", JSON.stringify(rows), 300);
  return rows.slice(0, limit);
}

/** Flagged pairs from the wallet's last Wallet Check, so only risky approvals earn revoke points. */
export async function rememberFlagged(store: CounterStore, owner: string, pairs: { token: string; spender: string }[]) {
  await store.put(`flagged:${w(owner)}`, JSON.stringify(pairs.map((p) => `${w(p.token)}|${w(p.spender)}`)), 30 * 86_400);
}

const REVOKE_EVENTS = parseAbi([
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
  "event Lockdown(address indexed owner, address token, address spender)",
  "event Approval(address indexed owner, address indexed token, address indexed spender, uint160 amount, uint48 expiration)",
]);

/** Verifies a revoke transaction and awards points for every flagged pair it set to zero. */
export async function claimRevoke(store: CounterStore, client: PublicClient, owner: Address, txHash: Hex) {
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") return { awarded: 0, pairs: [], error: "transaction_failed" };
  const tx = await client.getTransaction({ hash: txHash });
  if (w(tx.from) !== w(owner)) return { awarded: 0, pairs: [], error: "not_sender" };
  const flagged = new Set(JSON.parse((await store.fetch(`flagged:${w(owner)}`)) ?? "[]") as string[]);
  const revoked: string[] = [];
  for (const l of parseEventLogs({ abi: REVOKE_EVENTS, logs: receipt.logs, strict: false })) {
    const a = l.args as Record<string, unknown>;
    if (!a.owner || w(String(a.owner)) !== w(owner)) continue;
    if (l.eventName === "Approval" && "value" in a && a.value === 0n) revoked.push(`${w(l.address)}|${w(String(a.spender))}`);
    else if (l.eventName === "ApprovalForAll" && a.approved === false) revoked.push(`${w(l.address)}|${w(String(a.operator))}`);
    else if (l.eventName === "Lockdown" && w(l.address) === w(PERMIT2)) revoked.push(`${w(String(a.token))}|${w(String(a.spender))}`);
    else if (l.eventName === "Approval" && "amount" in a && a.amount === 0n && w(l.address) === w(PERMIT2)) revoked.push(`${w(String(a.token))}|${w(String(a.spender))}`);
  }
  let awarded = 0; const pairs: string[] = []; let capped = false;
  const day = new Date().toISOString().slice(0, 10);
  for (const p of revoked) {
    if (!flagged.has(p)) continue;
    if (await store.fetch(`points:once:revoke:${w(owner)}:${p}`)) continue;
    const [today, season] = await Promise.all([store.get(`points:revokes:${w(owner)}:${day}`), store.get(`points:revokes:${w(owner)}`)]);
    if (today >= RULES.revokeDailyCap || season >= RULES.revokeSeasonCap) { capped = true; continue; }
    const got = await award(store, owner, "revoke", RULES.revoke, `revoke:${w(owner)}:${p}`, txHash);
    if (got) {
      awarded += got; pairs.push(p);
      await store.incr(`points:revokes:${w(owner)}:${day}`, 2 * 86_400);
      await store.incr(`points:revokes:${w(owner)}`, FOREVER);
    }
  }
  if (capped && !awarded) return { awarded: 0, pairs: [], error: "revoke_points_cap" };
  return { awarded, pairs, error: revoked.length ? undefined : "no_revoke_in_transaction" };
}

/** API-key checks: one point per RULES.checksPerPoint checks, capped per day. */
export async function countCheck(store: CounterStore, owner: string, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const n = await store.incr(`points:checks:${w(owner)}:${day}`, 2 * 86_400);
  if (n % RULES.checksPerPoint === 0 && n / RULES.checksPerPoint <= RULES.checkPointsDailyCap) await award(store, owner, "checks", 1, undefined, day, now);
}

/** Daily vault-deposit snapshot pushed by the monitor: { wallet: usdgValue }. Idempotent per day. */
export async function applyDepositSnapshot(store: CounterStore, day: string, holdings: Record<string, number>) {
  let total = 0;
  for (const [wallet, usd] of Object.entries(holdings)) {
    const pts = Math.floor(usd / 100) * RULES.depositPer100Usd;
    total += await award(store, getAddress(wallet), "deposit", pts, `deposit:${day}:${w(wallet)}`, day);
  }
  return total;
}

// ── drainer reports ──────────────────────────────────────────────────────────
export interface Report { id: string; reporter: string; address: string; evidence: string; note?: string; at: number; status: "pending" | "confirmed" | "rejected" }

export async function submitReport(store: CounterStore, r: Omit<Report, "id" | "at" | "status">, now = Date.now()): Promise<Report> {
  const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const rep: Report = { ...r, address: w(r.address), reporter: w(r.reporter), id, at: now, status: "pending" };
  await store.put(`report:${id}`, JSON.stringify(rep), 365 * 86_400);
  await store.addMember("reports:pending", id);
  return rep;
}

export async function listReports(store: CounterStore, status: "pending" = "pending") {
  const ids = await store.members(`reports:${status}`);
  return (await Promise.all(ids.map(async (id) => JSON.parse((await store.fetch(`report:${id}`)) ?? "null") as Report | null))).filter(Boolean) as Report[];
}

/** Reviewer decision. A confirmed report adds the address to the community blocklist and pays the reporter once per address. */
export async function decideReport(store: CounterStore, id: string, confirm: boolean, onBlock: (address: string) => void) {
  const rep = JSON.parse((await store.fetch(`report:${id}`)) ?? "null") as Report | null;
  if (!rep || rep.status !== "pending") return null;
  rep.status = confirm ? "confirmed" : "rejected";
  await store.put(`report:${id}`, JSON.stringify(rep), 365 * 86_400);
  await store.removeMember("reports:pending", id);
  if (confirm) {
    await store.addMember("blocklist:community", rep.address);
    onBlock(rep.address);
    await award(store, rep.reporter, "report", RULES.report, `report:${rep.address}`, rep.address);
  }
  return rep;
}
