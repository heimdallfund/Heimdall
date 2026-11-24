import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isAddress } from "viem";
import type { CounterStore } from "./store.js";
import { publicUrlProblem, type Resolver } from "./net.js";

/**
 * Webhooks for developers: the owner of an API key registers one HTTPS endpoint and gets a signed POST when Shield
 * denies or warns on a check made with their keys, and when a wallet they watch (their agents) gains a risky approval.
 *
 * Signature: header `heimdall-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
 */
export const EVENTS = ["shield.deny", "shield.warn", "wallet.risky_approval"] as const;
export type HookEvent = (typeof EVENTS)[number] | "test";
export interface Hook { url: string; events: HookEvent[]; wallets: string[]; secret: string; created: number; disabled?: string; failures: number }
export interface Delivery { id: string; type: HookEvent; at: number; status: number | null; ok: boolean; ms: number; error?: string }

const FOREVER = 400 * 86_400;
const MAX_WALLETS = 20;
const DISABLE_AFTER = 15;
const w = (a: string) => a.toLowerCase();
const hookKey = (owner: string) => `hook:${w(owner)}`;

/** HTTPS only, and never to this machine or a private network (no SSRF into our own infrastructure). */
export function validHookUrl(raw: string, allowInsecure = false): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "Not a valid URL."; }
  if (u.protocol !== "https:" && !(allowInsecure && u.protocol === "http:")) return "The URL must start with https://.";
  if (u.username || u.password) return "Leave credentials out of the URL; check the signature instead.";
  if (raw.length > 500) return "The URL is too long.";
  if (allowInsecure) return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return "Use a public hostname.";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return "Use a public address.";
  }
  if (h.includes(":") && (/^(::1|fc|fd|fe80)/.test(h) || h === "::")) return "Use a public address.";
  return null;
}

export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** The same check the SDK ships (`verifyWebhook`), kept here for tests. */
export function verify(secret: string, body: string, header: string, toleranceSec = 300, now = Date.now()) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  const got = Buffer.from(parts.v1);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function getHook(store: CounterStore, owner: string) {
  return JSON.parse((await store.fetch(hookKey(owner))) ?? "null") as Hook | null;
}

/** Public view: never the secret. */
export async function hookView(store: CounterStore, owner: string) {
  const h = await getHook(store, owner);
  if (!h) return null;
  const { secret, ...rest } = h;
  const deliveries = JSON.parse((await store.fetch(`hook:log:${w(owner)}`)) ?? "[]") as Delivery[];
  return { ...rest, secretHint: `…${secret.slice(-4)}`, deliveries };
}

export async function setHook(store: CounterStore, owner: string, input: { url?: string; events?: string[]; wallets?: string[] }, opts: { allowInsecure?: boolean } = {}) {
  const url = String(input.url ?? "").trim();
  const bad = validHookUrl(url, opts.allowInsecure);
  if (bad) return { ok: false as const, error: "invalid_url", message: bad };
  const events = [...new Set((input.events ?? EVENTS).filter((e): e is (typeof EVENTS)[number] => (EVENTS as readonly string[]).includes(e)))];
  if (!events.length) return { ok: false as const, error: "no_events", message: "Pick at least one event." };
  const wallets = [...new Set((input.wallets ?? []).map((a) => String(a).trim()).filter(Boolean))];
  if (wallets.some((a) => !isAddress(a))) return { ok: false as const, error: "invalid_wallet", message: "Every wallet must be a 0x address." };
  if (wallets.length > MAX_WALLETS) return { ok: false as const, error: "too_many_wallets", message: `Up to ${MAX_WALLETS} wallets.` };
  const prev = await getHook(store, owner);
  const secret = prev?.secret ?? `whsec_${randomBytes(24).toString("base64url")}`;
  const hook: Hook = { url, events, wallets: wallets.map(w), secret, created: prev?.created ?? Date.now(), failures: 0 };
  await store.put(hookKey(owner), JSON.stringify(hook), FOREVER);
  // watched agent wallets ride on Wallet Watch
  for (const a of prev?.wallets ?? []) if (!hook.wallets.includes(a)) await unwatch(store, owner, a);
  for (const a of hook.wallets) { await store.addMember(`watch:hooks:${a}`, w(owner)); await store.addMember("watch:addresses", a); }
  return { ok: true as const, secret: prev ? undefined : secret, hook: await hookView(store, owner) };
}

async function unwatch(store: CounterStore, owner: string, a: string) {
  await store.removeMember(`watch:hooks:${a}`, w(owner));
  if (!(await store.members(`watch:hooks:${a}`)).length && !(await store.members(`watch:addr:${a}`)).length) {
    await store.removeMember("watch:addresses", a); await store.remove(`watch:seen:${a}`);
  }
}

export async function rotateSecret(store: CounterStore, owner: string) {
  const h = await getHook(store, owner);
  if (!h) return null;
  h.secret = `whsec_${randomBytes(24).toString("base64url")}`;
  await store.put(hookKey(owner), JSON.stringify(h), FOREVER);
  return h.secret;
}

export async function deleteHook(store: CounterStore, owner: string) {
  const h = await getHook(store, owner);
  if (!h) return false;
  for (const a of h.wallets) await unwatch(store, owner, a);
  await store.remove(hookKey(owner)); await store.remove(`hook:log:${w(owner)}`);
  return true;
}

/** Sends one event. Never throws; records the attempt and switches the hook off after repeated failures. */
export async function deliver(store: CounterStore, owner: string, type: HookEvent, data: unknown, fetcher: typeof fetch = fetch, opts: { allowInsecure?: boolean; resolve?: Resolver } = {}): Promise<Delivery | null> {
  const h = await getHook(store, owner);
  if (!h || (type !== "test" && (h.disabled || !h.events.includes(type)))) return null;
  if (validHookUrl(h.url, opts.allowInsecure)) return null;
  // resolved at delivery time too, so a public name later pointed at a private address is refused
  if (!opts.allowInsecure && (await publicUrlProblem(h.url, { resolve: opts.resolve }))) return null;
  const id = `evt_${randomBytes(9).toString("base64url")}`;
  const body = JSON.stringify({ id, type, createdAt: new Date().toISOString(), data });
  const t0 = Date.now();
  let status: number | null = null; let error: string | undefined;
  try {
    const r = await fetcher(h.url, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(5_000), body,
      headers: { "content-type": "application/json", "user-agent": "Heimdall-Webhooks/1", "heimdall-event": type, "heimdall-delivery": id, "heimdall-signature": sign(h.secret, body) },
    });
    status = r.status;
  } catch (e) { error = (e as Error).name === "TimeoutError" ? "timed out after 5 s" : "could not connect"; }
  const ok = status !== null && status >= 200 && status < 300;
  const d: Delivery = { id, type, at: t0, status, ok, ms: Date.now() - t0, ...(error ? { error } : {}) };
  const log = JSON.parse((await store.fetch(`hook:log:${w(owner)}`)) ?? "[]") as Delivery[];
  await store.put(`hook:log:${w(owner)}`, JSON.stringify([d, ...log].slice(0, 20)), FOREVER);
  if (type !== "test") {
    h.failures = ok ? 0 : h.failures + 1;
    if (h.failures >= DISABLE_AFTER) h.disabled = `Switched off after ${DISABLE_AFTER} failed deliveries in a row. Save the webhook again to switch it back on.`;
    await store.put(hookKey(owner), JSON.stringify(h), FOREVER);
  }
  return d;
}

/** Owners whose webhook watches this wallet. */
export const hookOwnersOf = (store: CounterStore, address: string) => store.members(`watch:hooks:${w(address)}`);

/** Keeps a promise alive after the response on Vercel (same mechanism as @vercel/functions' waitUntil). */
export function background(p: Promise<unknown>) {
  const ctx = (globalThis as unknown as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } } | undefined>)[Symbol.for("@vercel/request-context")]?.get?.();
  const safe = p.catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(safe);
}
