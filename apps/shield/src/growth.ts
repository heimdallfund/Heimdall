import { createHash } from "node:crypto";
import { type Address, type Hex, type PublicClient, decodeFunctionData, getAddress, parseAbi } from "viem";
import type { CounterStore } from "./store.js";
import { award, RULES, setQualifiedHook } from "./points.js";

/**
 * Growth before and after launch, built so points still mean real participation:
 *  - Early access: one registration per wallet that has sent at least one transaction on Robinhood Chain.
 *  - Referrals: an invite link per wallet. The inviter earns points only when the invited wallet first does something
 *    real (a stake, a Pay job, a vault deposit, a confirmed drainer report), never for sign-ups alone.
 *  - Verified actions: first stake and first Pay job earn a small bonus, checked from the transaction itself.
 */

const FOREVER = 10 * 365 * 86_400;
const w = (a: string) => a.toLowerCase();
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

// ── referral codes ───────────────────────────────────────────────────────────
/** Short, stable code for a wallet. Not secret: it only says who invited whom. */
export function referralCode(address: string, salt = process.env.REFERRAL_SALT ?? "heimdall"): string {
  return BigInt(`0x${createHash("sha256").update(`${salt}:${w(address)}`).digest("hex").slice(0, 12)}`).toString(36).padStart(8, "0").slice(-8);
}

export async function rememberCode(store: CounterStore, address: string) {
  const code = referralCode(address);
  await store.put(`ref:code:${code}`, w(address), FOREVER);
  return code;
}

export async function resolveCode(store: CounterStore, code: string): Promise<string | null> {
  return /^[0-9a-z]{8}$/.test(code) ? store.fetch(`ref:code:${code}`) : null;
}

/** Links an invited wallet to its inviter. Only new wallets (no points yet), never yourself, never twice. */
export async function bindReferral(store: CounterStore, referee: string, code: string): Promise<{ ok: boolean; reason?: string; inviter?: string }> {
  const inviter = await resolveCode(store, code);
  if (!inviter) return { ok: false, reason: "unknown_code" };
  if (inviter === w(referee)) return { ok: false, reason: "self" };
  if (await store.fetch(`ref:of:${w(referee)}`)) return { ok: false, reason: "already_invited" };
  const qualifying = await Promise.all(["report", "deposit", "action"].map((r) => store.get(`points:${w(referee)}:${r}`)));
  if (qualifying.some((n) => n > 0)) return { ok: false, reason: "not_new" };
  await store.put(`ref:of:${w(referee)}`, inviter, FOREVER);
  await store.addMember(`ref:invited:${inviter}`, w(referee));
  await store.addMember("ref:inviters", inviter);
  await store.incr(`ref:day:${today()}`, 120 * 86_400);
  return { ok: true, inviter };
}

/** Called by award() when a wallet earns points from real use: pays its inviter once. */
export async function qualify(store: CounterStore, referee: string) {
  const inviter = await store.fetch(`ref:of:${w(referee)}`);
  if (!inviter || (await store.fetch(`ref:qualified:${w(referee)}`))) return;
  await store.put(`ref:qualified:${w(referee)}`, "1", FOREVER);
  await store.addMember(`ref:qualifiedBy:${inviter}`, w(referee));
  await store.incr(`ref:qday:${today()}`, 120 * 86_400);
  const paid = await store.get(`ref:paid:${inviter}`);
  if (paid < RULES.referralCap) {
    await store.incr(`ref:paid:${inviter}`, FOREVER);
    await award(store, inviter, "referral", RULES.referral, `referral:${w(referee)}`, w(referee));
  }
  await award(store, referee, "referral", RULES.welcome, `welcome:${w(referee)}`, inviter);
}
setQualifiedHook(qualify);

export async function referralStats(store: CounterStore, address: string) {
  const code = await rememberCode(store, address);
  const [invited, qualified] = await Promise.all([store.members(`ref:invited:${w(address)}`), store.members(`ref:qualifiedBy:${w(address)}`)]);
  return { code, invited: invited.length, qualified: qualified.length, points: await store.get(`points:${w(address)}:referral`), cap: RULES.referralCap };
}

// ── early access ─────────────────────────────────────────────────────────────
export function earlyOpen(env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  const until = env.EARLY_ACCESS_UNTIL ? Date.parse(env.EARLY_ACCESS_UNTIL) : NaN;
  return { open: Number.isNaN(until) || now < until, until: Number.isNaN(until) ? null : until };
}

export async function earlyStatus(store: CounterStore, env: NodeJS.ProcessEnv = process.env) {
  return { ...earlyOpen(env), count: (await store.members("early:members")).length, points: RULES.early };
}

export async function registerEarly(store: CounterStore, client: PublicClient, wallet: string, opts: { ipKey?: string; code?: string; env?: NodeJS.ProcessEnv } = {}) {
  const env = opts.env ?? process.env;
  if (!earlyOpen(env).open) return { ok: false as const, error: "closed", message: "Early access has closed." };
  const prev = await store.fetch(`early:${w(wallet)}`);
  if (prev) return { ok: true as const, already: true, at: (JSON.parse(prev) as { at: number }).at, code: await rememberCode(store, wallet) };
  if (opts.ipKey && (await store.incr(`early:ip:${opts.ipKey}`, 86_400)) > 3) return { ok: false as const, error: "too_many", message: "Too many sign-ups from this network today." };
  const nonce = await client.getTransactionCount({ address: getAddress(wallet) }).catch(() => 0);
  if (nonce < 1) return { ok: false as const, error: "no_history", message: "This wallet has never sent a transaction on Robinhood Chain. Early access is for wallets with some history." };
  const rec = { at: Date.now() };
  // kept for the admin's sybil view only: the hashed network of the day and how much history the wallet had
  await store.put(`early:${w(wallet)}`, JSON.stringify({ ...rec, nonce, net: opts.ipKey ?? null }), FOREVER);
  await store.addMember("early:members", w(wallet));
  await store.incr(`early:day:${today()}`, 120 * 86_400);
  await award(store, wallet, "early", RULES.early, `early:${w(wallet)}`);
  const bound = opts.code ? await bindReferral(store, wallet, opts.code) : undefined;
  return { ok: true as const, already: false, ...rec, points: RULES.early, code: await rememberCode(store, wallet), referral: bound };
}

/** Hashes the caller IP with today's date, so the rate limit keeps no IP address and nothing outlives the day. */
export const ipKey = (ip: string) => createHash("sha256").update(`${new Date().toISOString().slice(0, 10)}:${ip}`).digest("hex").slice(0, 24);

// ── verified product actions ─────────────────────────────────────────────────
const STAKE = parseAbi(["function stake(uint256 amount)"]);
const PAY = parseAbi(["function createJob(address provider, address arbiter, uint96 amount, uint64 deadline, uint32 reviewWindow, uint16 arbiterFeeBps, bytes32 specHash)"]);

/** First stake (≥ 1,000 $HEIM) and first Pay job (≥ 10 USDG) earn a bonus, checked from the transaction itself. */
export async function claimAction(store: CounterStore, client: PublicClient, owner: Address, txHash: Hex, env: NodeJS.ProcessEnv = process.env) {
  const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash: txHash }), client.getTransaction({ hash: txHash })]);
  if (receipt.status !== "success") return { awarded: 0, error: "transaction_failed" };
  if (w(tx.from) !== w(owner)) return { awarded: 0, error: "not_sender" };
  const to = tx.to ? w(tx.to) : "";
  if (env.HEIMDALL_STAKING_ADDRESS && to === w(env.HEIMDALL_STAKING_ADDRESS)) {
    const d = (() => { try { return decodeFunctionData({ abi: STAKE, data: tx.input }); } catch { return null; } })();
    if (!d || (d.args[0] as bigint) < 1_000n * 10n ** 18n) return { awarded: 0, error: "below_minimum", message: "Stake at least 1,000 $HEIM." };
    return { kind: "stake", awarded: await award(store, owner, "action", RULES.stake, `action:stake:${w(owner)}`, txHash) };
  }
  if (env.HEIMDALL_PAY_ADDRESS && to === w(env.HEIMDALL_PAY_ADDRESS)) {
    const d = (() => { try { return decodeFunctionData({ abi: PAY, data: tx.input }); } catch { return null; } })();
    if (!d || (d.args[2] as bigint) < 10_000_000n) return { awarded: 0, error: "below_minimum", message: "Jobs of at least 10 USDG count." };
    if (w(d.args[0] as string) === w(owner)) return { awarded: 0, error: "self_job" };
    return { kind: "pay", awarded: await award(store, owner, "action", RULES.pay, `action:pay:${w(owner)}`, txHash) };
  }
  return { awarded: 0, error: "not_a_heimdall_action" };
}

// ── admin view ───────────────────────────────────────────────────────────────
export interface InviterRow { inviter: string; invited: number; qualified: number; points: number; flags: string[] }

/**
 * Growth for the admin panel: daily sign-ups, invites and qualified invites, and the top inviters with signs of
 * farming: invitees that never do anything, invitees signed up from the same network on the same day, or invitees
 * with almost no onchain history.
 */
export async function growthStats(store: CounterStore, days = 14, now = Date.now()) {
  const dayList = Array.from({ length: days }, (_, i) => today(now - (days - 1 - i) * 86_400_000));
  const series = await Promise.all(dayList.map(async (d) => {
    const [signups, invites, qualified] = await Promise.all([store.get(`early:day:${d}`), store.get(`ref:day:${d}`), store.get(`ref:qday:${d}`)]);
    return { day: d, signups, invites, qualified };
  }));
  const inviters = await store.members("ref:inviters");
  const rows: InviterRow[] = await Promise.all(inviters.map(async (inviter) => {
    const [invited, qualified, points] = await Promise.all([store.members(`ref:invited:${inviter}`), store.members(`ref:qualifiedBy:${inviter}`), store.get(`points:${inviter}:referral`)]);
    const flags: string[] = [];
    if (invited.length >= 5 && qualified.length === 0) flags.push(`${invited.length} invited, none used Heimdall`);
    const recs = (await Promise.all(invited.slice(0, 50).map((a) => store.fetch(`early:${a}`)))).filter((x): x is string => !!x).map((x) => JSON.parse(x) as { nonce?: number; net?: string | null });
    const nets = new Map<string, number>();
    for (const r of recs) if (r.net) nets.set(r.net, (nets.get(r.net) ?? 0) + 1);
    const sameNet = Math.max(0, ...nets.values());
    if (sameNet >= 3) flags.push(`${sameNet} invitees signed up from one network on one day`);
    const thin = recs.filter((r) => (r.nonce ?? 99) <= 2).length;
    if (recs.length >= 3 && thin / recs.length >= 0.6) flags.push(`${thin} of ${recs.length} invitees have 1–2 transactions in total`);
    return { inviter, invited: invited.length, qualified: qualified.length, points, flags };
  }));
  rows.sort((a, b) => b.invited - a.invited);
  const sum = (k: "invited" | "qualified") => rows.reduce((a, r) => a + r[k], 0);
  return {
    series,
    totals: { early: (await store.members("early:members")).length, inviters: rows.length, invited: sum("invited"), qualified: sum("qualified") },
    top: rows.slice(0, 20),
    flagged: rows.filter((r) => r.flags.length).slice(0, 50),
  };
}
