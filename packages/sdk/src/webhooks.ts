/** Events Heimdall can POST to your endpoint. */
export type WebhookEventType = "shield.deny" | "shield.warn" | "wallet.risky_approval" | "test";
export interface WebhookEvent<T = Record<string, unknown>> { id: string; type: WebhookEventType; createdAt: string; data: T }

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Checks the `heimdall-signature` header of a webhook (`t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`)
 * against the raw request body, and rejects events older than `toleranceSec`. Works in Node 18+, Deno, Bun, edge
 * runtimes and browsers (Web Crypto). Pass the body exactly as received, before any JSON parsing.
 *
 *   const ok = await verifyWebhook({ secret: process.env.HEIMDALL_WEBHOOK_SECRET!, body: rawBody, signature: req.headers["heimdall-signature"] });
 */
export async function verifyWebhook(o: { secret: string; body: string; signature: string | null | undefined; toleranceSec?: number; now?: number }): Promise<boolean> {
  if (!o.signature) return false;
  const parts = Object.fromEntries(o.signature.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs((o.now ?? Date.now()) / 1000 - t) > (o.toleranceSec ?? 300)) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(o.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${o.body}`)));
  if (want.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

/** Verifies and parses in one step; throws on a bad signature. */
export async function parseWebhook<T = Record<string, unknown>>(o: { secret: string; body: string; signature: string | null | undefined; toleranceSec?: number }): Promise<WebhookEvent<T>> {
  if (!(await verifyWebhook(o))) throw new Error("Invalid Heimdall webhook signature");
  return JSON.parse(o.body) as WebhookEvent<T>;
}
