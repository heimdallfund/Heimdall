import { createHash, timingSafeEqual } from "node:crypto";
import type { CounterStore } from "./store.js";

export type Plan = "free" | "pro";

export interface Caller {
  plan: Plan;
  id: string; // key name, or "ip:<addr>" for anonymous callers
}

export interface LimitsConfig {
  /** name → sha256(hex) of the API key */
  keys: Map<string, Buffer>;
  requireKey: boolean;
  freePerMinute: number;
  proPerMinute: number;
  freeChecksPerWalletPerDay: number;
}

export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): LimitsConfig {
  const keys = new Map<string, Buffer>();
  for (const entry of (env.SHIELD_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [name, hash] = entry.split(":");
    if (name && hash && /^[0-9a-f]{64}$/i.test(hash)) keys.set(name, Buffer.from(hash, "hex"));
  }
  return {
    keys,
    requireKey: env.SHIELD_REQUIRE_KEY === "true",
    freePerMinute: Number(env.SHIELD_FREE_RPM ?? 30),
    proPerMinute: Number(env.SHIELD_PRO_RPM ?? 600),
    freeChecksPerWalletPerDay: Number(env.SHIELD_FREE_DAILY ?? 1000),
  };
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest();

/** Resolve the caller from an API key (constant-time compare against stored hashes). */
export function identify(cfg: LimitsConfig, apiKey: string | undefined, ip: string): Caller | null {
  if (apiKey) {
    const h = sha256(apiKey);
    for (const [name, stored] of cfg.keys) {
      if (stored.length === h.length && timingSafeEqual(stored, h)) return { plan: "pro", id: name };
    }
    return null; // a wrong key is an error, never a silent downgrade
  }
  return { plan: "free", id: `ip:${ip}` };
}

export interface LimitResult { ok: boolean; limit: number; remaining: number; reason?: string; retryAfter?: number }

export async function checkRate(store: CounterStore, cfg: LimitsConfig, caller: Caller, nowMs = Date.now()): Promise<LimitResult> {
  const limit = caller.plan === "pro" ? cfg.proPerMinute : cfg.freePerMinute;
  const window = Math.floor(nowMs / 60_000);
  const n = await store.incr(`rl:${caller.id}:${window}`, 70);
  const remaining = Math.max(0, limit - n);
  if (n > limit) return { ok: false, limit, remaining, reason: "rate_limited", retryAfter: 60 - Math.floor((nowMs / 1000) % 60) };
  return { ok: true, limit, remaining };
}

/** Free plan: N checks per day per agent wallet (`from`). Pro keys are metered instead. */
export async function checkDailyQuota(store: CounterStore, cfg: LimitsConfig, caller: Caller, wallet: string, nowMs = Date.now(), multiplier = 1): Promise<LimitResult> {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  if (caller.plan === "pro") {
    await store.incr(`usage:${caller.id}:${day}`, 40 * 86_400);
    return { ok: true, limit: Infinity, remaining: Infinity };
  }
  const n = await store.incr(`q:${wallet.toLowerCase()}:${day}`, 86_400 + 3_600);
  const limit = cfg.freeChecksPerWalletPerDay * multiplier;
  if (n > limit) return { ok: false, limit, remaining: 0, reason: "daily_quota_exceeded" };
  return { ok: true, limit, remaining: limit - n };
}
