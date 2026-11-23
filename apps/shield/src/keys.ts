import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { getAddress, isAddress, type Address, type PublicClient } from "viem";
import { sha256 } from "./limits.js";
import type { CounterStore } from "./store.js";
import { deleteHook, deliver, hookView, rotateSecret, setHook } from "./webhooks.js";

/**
 * Self-service API keys. Sign in with a wallet signature (EOA or smart wallet via ERC-1271/6492),
 * then create, list and revoke keys. Only sha256(key) is stored; the key is shown once.
 */
export interface KeyRecord { id: string; owner: Address; name: string; created: string; last4: string }

const CHALLENGE_TTL = 600;
const SESSION_TTL = 3_600;
const MAX_KEYS = 10;

export const challengeMessage = (address: Address, nonce: string, issued: string) =>
  `Sign in to Heimdall to manage your Shield API keys.\n\nWallet: ${address}\nNonce: ${nonce}\nIssued: ${issued}\n\nThis does not send a transaction or cost gas.`;

export async function lookupStoredKey(store: CounterStore, apiKey: string): Promise<string | null> {
  const rec = await store.fetch(`apikey:${sha256(apiKey).toString("hex")}`);
  if (!rec) return null;
  const r = JSON.parse(rec) as KeyRecord;
  return `acct:${r.owner.toLowerCase()}:${r.id}`;
}

export function keysRoutes(store: CounterStore, client: () => PublicClient, opts: { allowInsecureHooks?: boolean } = {}) {
  const app = new Hono<{ Variables: { owner: Address } }>();

  app.post("/auth/challenge", async (c) => {
    const { address } = (await c.req.json().catch(() => ({}))) as { address?: string };
    if (!address || !isAddress(address)) return c.json({ error: "invalid_address" }, 400);
    const owner = getAddress(address);
    const nonce = randomBytes(16).toString("hex");
    const message = challengeMessage(owner, nonce, new Date().toISOString());
    await store.put(`challenge:${owner.toLowerCase()}`, message, CHALLENGE_TTL);
    return c.json({ message });
  });

  app.post("/auth/verify", async (c) => {
    const { address, signature } = (await c.req.json().catch(() => ({}))) as { address?: string; signature?: `0x${string}` };
    if (!address || !isAddress(address) || !signature) return c.json({ error: "invalid_request" }, 400);
    const owner = getAddress(address);
    const message = await store.fetch(`challenge:${owner.toLowerCase()}`);
    if (!message) return c.json({ error: "challenge_expired" }, 401);
    const ok = await client().verifyMessage({ address: owner, message, signature }).catch(() => false);
    if (!ok) return c.json({ error: "bad_signature" }, 401);
    await store.remove(`challenge:${owner.toLowerCase()}`);
    const session = randomBytes(24).toString("base64url");
    await store.put(`session:${sha256(session).toString("hex")}`, owner, SESSION_TTL);
    return c.json({ session, expiresIn: SESSION_TTL });
  });

  app.use("/keys/*", async (c, next) => {
    const h = c.req.header("authorization") ?? "";
    const token = h.startsWith("Session ") ? h.slice(8) : "";
    const owner = token ? await store.fetch(`session:${sha256(token).toString("hex")}`) : null;
    if (!owner) return c.json({ error: "not_signed_in" }, 401);
    c.set("owner", owner as Address);
    await next();
  });
  app.use("/keys", async (c, next) => {
    const h = c.req.header("authorization") ?? "";
    const token = h.startsWith("Session ") ? h.slice(8) : "";
    const owner = token ? await store.fetch(`session:${sha256(token).toString("hex")}`) : null;
    if (!owner) return c.json({ error: "not_signed_in" }, 401);
    c.set("owner", owner as Address);
    await next();
  });

  app.use("/webhook", async (c, next) => {
    const h = c.req.header("authorization") ?? "";
    const token = h.startsWith("Session ") ? h.slice(8) : "";
    const owner = token ? await store.fetch(`session:${sha256(token).toString("hex")}`) : null;
    if (!owner) return c.json({ error: "not_signed_in" }, 401);
    c.set("owner", owner as Address);
    await next();
  });
  app.use("/webhook/*", async (c, next) => {
    const h = c.req.header("authorization") ?? "";
    const token = h.startsWith("Session ") ? h.slice(8) : "";
    const owner = token ? await store.fetch(`session:${sha256(token).toString("hex")}`) : null;
    if (!owner) return c.json({ error: "not_signed_in" }, 401);
    c.set("owner", owner as Address);
    await next();
  });
  app.get("/webhook", async (c) => c.json({ webhook: await hookView(store, c.get("owner")) }));
  app.put("/webhook", async (c) => {
    const r = await setHook(store, c.get("owner"), (await c.req.json().catch(() => ({}))) as Record<string, never>, { allowInsecure: opts.allowInsecureHooks });
    return c.json(r, r.ok ? 200 : 400);
  });
  app.delete("/webhook", async (c) => c.json({ ok: await deleteHook(store, c.get("owner")) }));
  app.post("/webhook/rotate", async (c) => {
    const secret = await rotateSecret(store, c.get("owner"));
    return secret ? c.json({ secret, note: "Copy the new secret now. The old one stops working immediately." }) : c.json({ error: "not_found" }, 404);
  });
  app.post("/webhook/test", async (c) => {
    const d = await deliver(store, c.get("owner"), "test", { message: "Test event from Heimdall. If you can read this, your endpoint works." }, fetch, { allowInsecure: opts.allowInsecureHooks });
    return d ? c.json(d) : c.json({ error: "not_found" }, 404);
  });

  const list = async (owner: Address) => {
    const ids = await store.members(`keys:${owner.toLowerCase()}`);
    const recs = await Promise.all(ids.map((id) => store.fetch(`keyrec:${id}`)));
    return recs.filter((r): r is string => !!r).map((r) => JSON.parse(r) as KeyRecord & { hash: string });
  };

  app.get("/keys", async (c) => {
    const owner = c.get("owner");
    const day = new Date().toISOString().slice(0, 10);
    const keys = await list(owner);
    const withUsage = await Promise.all(keys.map(async ({ hash: _h, ...k }) => ({ ...k, checksToday: await store.get(`usage:acct:${owner.toLowerCase()}:${k.id}:${day}`) })));
    return c.json(withUsage.sort((a, b) => b.created.localeCompare(a.created)));
  });

  app.post("/keys", async (c) => {
    const owner = c.get("owner");
    const { name } = (await c.req.json().catch(() => ({}))) as { name?: string };
    const clean = (name ?? "").trim().slice(0, 40) || "default";
    if ((await list(owner)).length >= MAX_KEYS) return c.json({ error: "too_many_keys", max: MAX_KEYS }, 400);
    const key = `hd_live_${randomBytes(24).toString("base64url")}`;
    const hash = sha256(key).toString("hex");
    const id = randomBytes(6).toString("hex");
    const rec = { id, owner, name: clean, created: new Date().toISOString(), last4: key.slice(-4), hash };
    await store.put(`apikey:${hash}`, JSON.stringify(rec));
    await store.put(`keyrec:${id}`, JSON.stringify(rec));
    await store.addMember(`keys:${owner.toLowerCase()}`, id);
    return c.json({ id, name: clean, key, note: "Copy this key now. Heimdall stores only its hash and cannot show it again." }, 201);
  });

  app.delete("/keys/:id", async (c) => {
    const owner = c.get("owner");
    const id = c.req.param("id");
    const rec = await store.fetch(`keyrec:${id}`);
    if (!rec) return c.json({ error: "not_found" }, 404);
    const r = JSON.parse(rec) as KeyRecord & { hash: string };
    if (r.owner.toLowerCase() !== owner.toLowerCase()) return c.json({ error: "not_found" }, 404);
    await Promise.all([store.remove(`apikey:${r.hash}`), store.remove(`keyrec:${id}`), store.removeMember(`keys:${owner.toLowerCase()}`, id)]);
    return c.json({ ok: true });
  });

  return app;
}
