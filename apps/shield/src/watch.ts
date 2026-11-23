import { createHash } from "node:crypto";
import type { CounterStore } from "./store.js";

/**
 * Wallet Watch: browser push notifications when a watched wallet gains a new risky approval (danger or review in
 * Wallet Check), for example one to a contract that later joins the blocklist. Only the wallet address and the push
 * address the browser hands out are stored; no account, no email.
 */
export interface PushSubscriptionJSON { endpoint: string; keys: { p256dh: string; auth: string } }
interface StoredSub extends PushSubscriptionJSON { addresses: string[]; at: number }
export type Sender = (sub: PushSubscriptionJSON, payload: string) => Promise<{ gone?: boolean }>;
export type Scan = (address: string) => Promise<{ approvals: { risk: string; token: string; symbol: string; spender: string; spenderLabel: string | null; atRiskUsd: number | null }[] }>;

const FOREVER = 400 * 86_400;
const MAX_PER_SUB = 5;
const MAX_ADDRESSES = 20_000;
const w = (a: string) => a.toLowerCase();
const subId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 20);

export function validSubscription(s: unknown): s is PushSubscriptionJSON {
  const v = s as PushSubscriptionJSON;
  return !!v && typeof v.endpoint === "string" && /^https:\/\/[^\s]{10,500}$/.test(v.endpoint)
    && !!v.keys && typeof v.keys.p256dh === "string" && typeof v.keys.auth === "string" && v.keys.p256dh.length < 200 && v.keys.auth.length < 100;
}

export async function subscribe(store: CounterStore, address: string, sub: PushSubscriptionJSON) {
  const id = subId(sub.endpoint);
  const prev = JSON.parse((await store.fetch(`watch:sub:${id}`)) ?? "null") as StoredSub | null;
  const addresses = [...new Set([...(prev?.addresses ?? []), w(address)])];
  if (addresses.length > MAX_PER_SUB) return { ok: false as const, error: "too_many_wallets", message: `One browser can watch up to ${MAX_PER_SUB} wallets.` };
  if (!(await store.members("watch:addresses")).includes(w(address)) && (await store.members("watch:addresses")).length >= MAX_ADDRESSES) return { ok: false as const, error: "full" };
  await store.put(`watch:sub:${id}`, JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys, addresses, at: prev?.at ?? Date.now() } satisfies StoredSub), FOREVER);
  await store.addMember(`watch:addr:${w(address)}`, id);
  await store.addMember("watch:addresses", w(address));
  return { ok: true as const, watching: addresses };
}

export async function unsubscribe(store: CounterStore, endpoint: string, address?: string) {
  const id = subId(endpoint);
  const prev = JSON.parse((await store.fetch(`watch:sub:${id}`)) ?? "null") as StoredSub | null;
  if (!prev) return { ok: true, watching: [] as string[] };
  const drop = address ? [w(address)] : prev.addresses;
  for (const a of drop) {
    await store.removeMember(`watch:addr:${a}`, id);
    if (!(await store.members(`watch:addr:${a}`)).length) { await store.removeMember("watch:addresses", a); await store.remove(`watch:seen:${a}`); }
  }
  const left = prev.addresses.filter((a) => !drop.includes(a));
  if (left.length) await store.put(`watch:sub:${id}`, JSON.stringify({ ...prev, addresses: left }), FOREVER);
  else await store.remove(`watch:sub:${id}`);
  return { ok: true, watching: left };
}

const key = (a: { token: string; spender: string }) => `${w(a.token)}|${w(a.spender)}`;

/**
 * One pass over watched wallets (at most `limit`, continuing where the last pass stopped). The first scan of a wallet
 * only records what is already there; after that, each new risky approval sends one notification to every browser
 * watching it. Push addresses the browser has revoked are removed.
 */
export async function runWatch(store: CounterStore, scan: Scan, send: Sender | null, opts: { limit?: number; siteUrl?: string; onRisky?: (address: string, fresh: Awaited<ReturnType<Scan>>["approvals"]) => Promise<void> } = {}) {
  const all = (await store.members("watch:addresses")).sort();
  const limit = opts.limit ?? 200;
  const cursor = Number((await store.fetch("watch:cursor")) ?? 0) % Math.max(1, all.length);
  const batch = [...all.slice(cursor), ...all.slice(0, cursor)].slice(0, limit);
  await store.put("watch:cursor", String((cursor + batch.length) % Math.max(1, all.length)));
  let scanned = 0, notified = 0, removed = 0, failed = 0;
  for (const address of batch) {
    let report;
    try { report = await scan(address); scanned++; } catch { failed++; continue; }
    const risky = report.approvals.filter((a) => a.risk === "danger" || a.risk === "review");
    const seenRaw = await store.fetch(`watch:seen:${address}`);
    const seen = new Set(JSON.parse(seenRaw ?? "[]") as string[]);
    const fresh = seenRaw === null ? [] : risky.filter((a) => !seen.has(key(a)));
    await store.put(`watch:seen:${address}`, JSON.stringify(risky.map(key)), FOREVER);
    if (!fresh.length) continue;
    if (opts.onRisky) await opts.onRisky(address, fresh).catch(() => {});
    if (!send) continue;
    const worst = fresh.find((a) => a.risk === "danger") ?? fresh[0]!;
    const usd = fresh.reduce((s, a) => s + (a.atRiskUsd ?? 0), 0);
    const payload = JSON.stringify({
      title: `${fresh.length === 1 ? "New risky approval" : `${fresh.length} new risky approvals`} on ${address.slice(0, 6)}…${address.slice(-4)}`,
      body: `${worst.symbol} → ${worst.spenderLabel ?? `${worst.spender.slice(0, 6)}…${worst.spender.slice(-4)}`}${usd > 0 ? ` · $${Math.round(usd).toLocaleString("en-US")} at risk` : ""}. Tap to review and revoke.`,
      url: `${opts.siteUrl ?? "https://heimdall.fund"}/check/${address}`,
      tag: `watch-${address}`,
    });
    for (const id of await store.members(`watch:addr:${address}`)) {
      const sub = JSON.parse((await store.fetch(`watch:sub:${id}`)) ?? "null") as StoredSub | null;
      if (!sub) { await store.removeMember(`watch:addr:${address}`, id); continue; }
      const r = await send(sub, payload).catch(() => ({ gone: false }));
      if (r.gone) { await unsubscribe(store, sub.endpoint); removed++; } else notified++;
    }
  }
  return { watched: all.length, scanned, notified, removed, failed };
}

/** web-push sender, configured from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT. */
export async function webPushSender(env: NodeJS.ProcessEnv = process.env): Promise<Sender | null> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  const mod = (await import("web-push")) as unknown as typeof import("web-push") & { default?: typeof import("web-push") };
  const wp = mod.default ?? mod; // web-push 4 ships named ESM exports only
  wp.setVapidDetails(env.VAPID_SUBJECT ?? "mailto:security@heimdall.fund", env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  return async (sub, payload) => {
    try { await wp.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: "high" }); return {}; }
    catch (e) { const code = (e as { statusCode?: number }).statusCode; return { gone: code === 404 || code === 410 }; }
  };
}
