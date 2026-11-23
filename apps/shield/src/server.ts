import { agentStats, loadVerdict, recordCheck, saveVerdict, threats } from "./insights.js";
import { scanWallet } from "./approvals.js";
import { currentSeason, recordSnapshots, standings, type Snapshot } from "./arena.js";
import { listIncidents, recordHeartbeat, status, upsertIncident } from "./status.js";
import { runWatch, subscribe, unsubscribe, validSubscription, webPushSender } from "./watch.js";
import { bindReferral, claimAction, earlyStatus, growthStats, ipKey, referralStats, registerEarly } from "./growth.js";
import { analytics, loadSeasons, logDecision, recentDecisions, saveSeasons, trackEvent, validateSeasons } from "./admin.js";
import { addCommunityBlock, communityEntries, removeCommunityBlock } from "./blocklist.js";
import { applyDepositSnapshot, claimRevoke, countCheck, decideReport, leaderboard, listReports, rememberFlagged, RULES, submitReport, walletPoints } from "./points.js";
import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { createPublicClient, fallback, http, isAddress, isHex, keccak256, toHex, type PublicClient } from "viem";
import { z } from "zod";
import { SUPPORTED_CHAINS, type SupportedChainId } from "./chains.js";
import { PolicySchema } from "./policy.js";
import { receiptDomain, RECEIPT_TYPES } from "./receipt.js";
import { getSigner } from "./signer.js";
import { checkTransaction, toJSON } from "./shield.js";
import { checkPersonalMessage, checkTypedData } from "./typed.js";
import { keysRoutes, lookupStoredKey } from "./keys.js";
import { background, deliver, hookOwnersOf } from "./webhooks.js";
import { storeFromEnv, type CounterStore } from "./store.js";
import { checkDailyQuota, checkRate, identify, limitsFromEnv, type Caller, type LimitsConfig } from "./limits.js";

const clients = new Map<number, PublicClient>();
const lastProvider = new Map<number, { name: string; rank: number; at: number }>();

/** A readable provider name from an RPC URL (the key in the path is never shown). */
export function providerName(url: string) {
  const h = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  if (/alchemy/.test(h)) return "Alchemy";
  if (/quiknode|quicknode/.test(h)) return "QuickNode";
  if (/drpc/.test(h)) return "dRPC";
  if (/chainstack/.test(h)) return "Chainstack";
  if (/blockdaemon/.test(h)) return "Blockdaemon";
  if (/chain\.robinhood\.com$/.test(h)) return "Robinhood public RPC";
  if (/^(127\.|localhost)/.test(h)) return "Local node";
  return h;
}

/**
 * Paid RPC first (RPC_URL_MAINNET), then a second paid provider (RPC_URL_MAINNET_BACKUP), then the public endpoint.
 * Every request tries them in this order and moves on when one errors or times out, so paid providers stay first.
 */
export function clientFor(chainId: SupportedChainId, env: NodeJS.ProcessEnv = process.env): PublicClient {
  let c = clients.get(chainId);
  if (!c) {
    const chain = SUPPORTED_CHAINS[chainId];
    const urls = [
      chainId === 4663 ? env.RPC_URL_MAINNET : env.RPC_URL_TESTNET,
      chainId === 4663 ? env.RPC_URL_MAINNET_BACKUP : env.RPC_URL_TESTNET_BACKUP,
      // a local fork (tests, E2E) must never fall through to mainnet, which has different state
      env.RPC_NO_PUBLIC_FALLBACK === "1" ? undefined : chain.rpcUrls.default.http[0],
    ].filter((u, i, a): u is string => !!u && a.indexOf(u) === i);
    const transports = urls.map((u, rank) => http(u, {
      timeout: Number(env.RPC_TIMEOUT_MS ?? 10_000), retryCount: rank === urls.length - 1 ? 1 : 0,
      onFetchResponse: (res) => { if (res.ok) lastProvider.set(chainId, { name: providerName(u), rank, at: Date.now() }); },
    }));
    c = createPublicClient({ chain, transport: transports.length > 1 ? fallback(transports, { rank: false, retryCount: 0 }) : transports[0] }) as PublicClient;
    clients.set(chainId, c);
  }
  return c;
}

/** Which provider answered last, and whether it is the first choice. */
export function activeProvider(chainId: SupportedChainId) {
  const p = lastProvider.get(chainId);
  return p ? { name: p.name, primary: p.rank === 0, at: p.at } : null;
}

const addr = z.string().refine(isAddress, "invalid address");
export const SignatureBody = z.object({
  chainId: z.union([z.literal(4663), z.literal(46630)]).default(4663),
  signer: addr,
  typedData: z.object({
    domain: z.record(z.string(), z.unknown()).optional(),
    types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))).optional(),
    primaryType: z.string(),
    message: z.record(z.string(), z.unknown()),
  }).optional(),
  message: z.string().max(16_384).optional(),
  policy: PolicySchema.optional(),
  share: z.boolean().optional(),
}).refine((b) => !!b.typedData !== !!b.message, "send exactly one of typedData or message");

export const CheckBody = z.object({
  chainId: z.union([z.literal(4663), z.literal(46630)]).default(4663),
  from: addr,
  to: addr.nullable().optional(),
  data: z.string().refine((v) => isHex(v), "data must be hex").max(65_536).default("0x"),
  value: z.union([z.string().regex(/^(0x[0-9a-fA-F]+|\d+)$/), z.number().int().nonnegative()]).default("0"),
  policy: PolicySchema.optional(),
  share: z.boolean().optional(),
  /** A lookup ("is this address safe?") from a throwaway wallet: judged normally but kept off the Threat Board and agent stats. */
  probe: z.boolean().optional(),
});

const LONG_TTL = 10 * 365 * 86_400;

export interface AppOptions {
  getClient?: (id: SupportedChainId) => PublicClient;
  store?: CounterStore;
  limits?: LimitsConfig;
  env?: NodeJS.ProcessEnv;
  log?: (line: Record<string, unknown>) => void;
  /** Optional lookup for self-service API keys (key → account name). */
  lookupKey?: (apiKey: string) => Promise<string | null>;
}

type Vars = { Variables: { caller: Caller } };

export function buildApp(opts: AppOptions = {}) {
  const env = opts.env ?? process.env;
  const getClient = opts.getClient ?? ((id: SupportedChainId) => clientFor(id, env));
  const store = opts.store ?? storeFromEnv(env);
  const limits = opts.limits ?? limitsFromEnv(env);
  const log = opts.log ?? ((l) => console.log(JSON.stringify(l)));
  const prod = env.NODE_ENV === "production";
  const origins = (env.SHIELD_CORS_ORIGINS ?? (prod ? "https://heimdall.fund,https://www.heimdall.fund" : "*")).split(",").map((s) => s.trim());

  async function resolveCaller(apiKey: string | undefined, ip: string): Promise<Caller | null> {
    const fromEnv = identify(limits, apiKey, ip);
    if (fromEnv || !apiKey) return fromEnv;
    const name = opts.lookupKey ? await opts.lookupKey(apiKey) : await lookupStoredKey(store, apiKey).catch(() => null);
    return name ? { plan: "pro", id: name } : null;
  }

  const app = new Hono<Vars>();
  app.use("*", cors({ origin: origins.includes("*") ? "*" : origins, allowHeaders: ["content-type", "authorization", "x-api-key", "x-admin-key"], maxAge: 600 }));
  app.use("*", async (c, next) => {
    const t = Date.now();
    await next();
    log({ t: new Date(t).toISOString(), method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - t, caller: c.get("caller")?.id });
  });

  app.get("/health", async (c) => {
    const t = Date.now();
    try {
      const block = await getClient(4663).getBlockNumber();
      return c.json({ ok: true, service: "heimdall-shield", version: "0.2.0", block: block.toString(), rpcMs: Date.now() - t });
    } catch {
      return c.json({ ok: false, service: "heimdall-shield", version: "0.2.0", error: "rpc_unreachable" }, 503);
    }
  });

  app.get("/v1/stats", async (c) => {
    const [checks, allowed, warned, denied] = await Promise.all(["checks", "allowed", "warned", "denied"].map((k) => store.get(`stats:${k}`)));
    return c.json({ checks, allowed, warned, denied });
  });

  app.get("/v1/signer", async (c) => {
    const s = await getSigner(env);
    return c.json({ signer: s.address, kind: s.kind, domain: receiptDomain(4663), types: RECEIPT_TYPES });
  });

  /** API key → per-minute rate limit → (after validation) free daily quota per wallet. */
  async function admit(c: any): Promise<Response | null> {
    const auth = c.req.header("authorization");
    const apiKey = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : c.req.header("x-api-key") ?? undefined;
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
    const caller = await resolveCaller(apiKey, ip);
    if (!caller) return c.json({ error: "invalid_api_key" }, 401);
    if (caller.plan === "free" && limits.requireKey) return c.json({ error: "api_key_required" }, 401);
    c.set("caller", caller);
    const rate = await checkRate(store, limits, caller);
    c.header("x-ratelimit-limit", String(rate.limit));
    c.header("x-ratelimit-remaining", String(rate.remaining));
    if (!rate.ok) {
      c.header("retry-after", String(rate.retryAfter ?? 60));
      return c.json({ error: "rate_limited", message: "Too many checks this minute. Use an API key for higher limits." }, 429);
    }
    return null;
  }

  /** $HEIM holders get a larger free quota. HEIM_HOLDER_ADDRESS (HeimdallHolderBalance: held + staked) is preferred over
   *  HEIM_ADDRESS (held only). HEIM_HOLDER_MIN in raw units with 18 decimals, HEIM_QUOTA_MULTIPLIER. */
  async function holderMultiplier(wallet: string): Promise<number> {
    const heim = env.HEIM_HOLDER_ADDRESS || env.HEIM_ADDRESS;
    if (!heim || !isAddress(heim)) return 1;
    const key = `heim:${wallet.toLowerCase()}`;
    let bal = await store.fetch(key).catch(() => null);
    if (bal === null) {
      const b = await getClient(4663).readContract({ address: heim as `0x${string}`, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [wallet as `0x${string}`] }).catch(() => 0n);
      bal = (b as bigint).toString();
      await store.put(key, bal, 600).catch(() => {});
    }
    return BigInt(bal) >= BigInt(env.HEIM_HOLDER_MIN ?? "100000000000000000000000") ? Number(env.HEIM_QUOTA_MULTIPLIER ?? 5) : 1;
  }

  async function quota(c: any, wallet: string): Promise<Response | null> {
    const caller = c.get("caller") as Caller;
    const mult = caller.plan === "free" ? await holderMultiplier(wallet) : 1;
    if (mult > 1) c.header("x-heimdall-holder", "true");
    const q = await checkDailyQuota(store, limits, caller, wallet, Date.now(), mult);
    if (Number.isFinite(q.remaining)) c.header("x-heimdall-quota-remaining", String(q.remaining));
    if (!q.ok) return c.json({ error: "daily_quota_exceeded", message: `Free plan: ${q.limit} checks per wallet per day. Use an API key to continue.` }, 429);
    return null;
  }

  const limitBody = bodyLimit({ maxSize: 128 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) });

  const hookInsecure = env.NODE_ENV === "test" || env.WEBHOOK_ALLOW_HTTP === "1";
  /** DENY / WARN on a check made with an account key → the owner's webhook, after the response. */
  function notifyVerdict(c: any, kind: "tx" | "sig", r: { checkId: string; verdict: string; riskScore: number; summary: string[]; findings: { code: string; severity: string; message: string }[] }, extra: Record<string, unknown>) {
    const callerId = (c.get("caller") as Caller | undefined)?.id ?? "";
    if (!callerId.startsWith("acct:") || r.verdict === "ALLOW") return;
    const [, owner, keyId] = callerId.split(":");
    const type = r.verdict === "DENY" ? "shield.deny" : "shield.warn";
    background(deliver(store, owner!, type, { kind, checkId: r.checkId, verdict: r.verdict, riskScore: r.riskScore, summary: r.summary, findings: r.findings.map((f) => ({ code: f.code, severity: f.severity, message: f.message })), apiKeyId: keyId, ...extra }, fetch, { allowInsecure: hookInsecure }));
  }

  app.post("/v1/check-signature", limitBody, async (c) => {
    const denied = await admit(c);
    if (denied) return denied;
    const parsed = SignatureBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    const b = parsed.data;
    const over = await quota(c, b.signer);
    if (over) return over;
    const policy = PolicySchema.parse(b.policy ?? {});
    try {
      const result = b.typedData
        ? await checkTypedData(b.chainId, b.signer as `0x${string}`, b.typedData as never, policy, getClient(b.chainId))
        : checkPersonalMessage(b.message!, policy);
      const bucket = result.verdict === "ALLOW" ? "allowed" : result.verdict === "WARN" ? "warned" : "denied";
      await Promise.all([store.incr("stats:checks", LONG_TTL), store.incr(`stats:${bucket}`, LONG_TTL)]).catch(() => {});
      const checkId = keccak256(toHex(`sig:${b.signer}:${Date.now()}:${Math.random()}`));
      const spender = result.approvals?.[0]?.spender ?? null;
      await recordCheck(store, { kind: "sig", wallet: b.signer, target: spender, result: { ...result, checkId } }).catch(() => {});
      if (b.share) await saveVerdict(store, checkId, { kind: "sig", at: Date.now(), chainId: b.chainId, signer: b.signer, primaryType: b.typedData?.primaryType ?? "personal_sign", result: toJSON(result) }).catch(() => {});
      notifyVerdict(c, "sig", { ...result, checkId } as never, { chainId: b.chainId, signer: b.signer, primaryType: b.typedData?.primaryType ?? "personal_sign" });
      return c.json(b.share ? { ...(toJSON(result) as object), shareId: checkId } : result);
    } catch (e) {
      log({ level: "error", path: "/v1/check-signature", message: (e as Error).message });
      return c.json({ error: "check_failed", message: "Shield could not complete the check. Do not sign." }, 500);
    }
  });

  app.post("/v1/check", limitBody, async (c) => {
    const denied = await admit(c);
    if (denied) return denied;

    // validate
    const parsed = CheckBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    const b = parsed.data;
    const over = await quota(c, b.from);
    if (over) return over;

    // 5. check
    try {
      const result = await checkTransaction(
        { chainId: b.chainId, from: b.from as `0x${string}`, to: (b.to ?? null) as `0x${string}` | null, data: b.data as `0x${string}`, value: BigInt(b.value) },
        b.policy,
        { client: getClient(b.chainId) },
      );
      const bucket = result.verdict === "ALLOW" ? "allowed" : result.verdict === "WARN" ? "warned" : "denied";
      await Promise.all([store.incr("stats:checks", LONG_TTL), store.incr(`stats:${bucket}`, LONG_TTL)]).catch(() => {});
      // For approvals the threat is the spender, not the token contract.
      const threatTarget = result.approvals?.[0]?.spender ?? b.to ?? null;
      if (!b.probe) await recordCheck(store, { kind: "tx", wallet: b.from, target: threatTarget, result: result as never }).catch(() => {});
      const callerId = (c.get("caller") as Caller | undefined)?.id ?? "";
      if (callerId.startsWith("acct:")) await countCheck(store, callerId.split(":")[1]!).catch(() => {});
      notifyVerdict(c, "tx", result as never, { chainId: b.chainId, from: b.from, to: b.to ?? null, value: String(b.value) });
      const json = toJSON(result) as Record<string, unknown>;
      if (b.share) {
        const { receipt: _r, ...pub } = json; // never publish a usable receipt
        await saveVerdict(store, result.checkId, { kind: "tx", at: Date.now(), chainId: b.chainId, tx: { from: b.from, to: b.to ?? null, data: b.data, value: String(b.value) }, result: pub }).catch(() => {});
        json.shareId = result.checkId;
      }
      return c.json(json);
    } catch (e) {
      log({ level: "error", path: "/v1/check", message: (e as Error).message });
      return c.json({ error: "check_failed", message: "Shield could not complete the check. Treat the transaction as unsafe." }, 500);
    }
  });

  app.get("/v1/verdicts/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return c.json({ error: "invalid_id" }, 400);
    const v = await loadVerdict(store, id);
    return v ? c.json(v) : c.json({ error: "not_found" }, 404);
  });

  // Short store-level memo for the heavy public aggregates (status reads ~180 keys, the threat board ~60).
  const memo = async <T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> => {
    const hit = await store.fetch(`memo:${key}`).catch(() => null);
    if (hit) return JSON.parse(hit) as T;
    const v = await fn();
    await store.put(`memo:${key}`, JSON.stringify(v), ttl).catch(() => {});
    return v;
  };

  const deniedTargets = async () => {
    const board = await memo("threats", 60, () => threats(store)).catch(() => ({ targets: [] as { address: string }[] }));
    return new Set(board.targets.map((t) => t.address.toLowerCase()));
  };

  app.get("/v1/threats", async (c) => {
    c.header("cache-control", "public, max-age=30, s-maxage=60");
    return c.json(await memo("threats", 60, () => threats(store)));
  });

  app.get("/v1/agents/:address", async (c) => {
    const a = c.req.param("address");
    if (!isAddress(a)) return c.json({ error: "invalid_address" }, 400);
    return c.json(await agentStats(store, a));
  });


  // ── Wallet Check ────────────────────────────────────────────────────────────
  app.get("/v1/wallet/:address", async (c) => {
    const a = c.req.param("address");
    if (!isAddress(a)) return c.json({ error: "invalid_address" }, 400);
    const blocked = await admit(c);
    if (blocked) return blocked;
    const cacheKey = `walletcache:${a.toLowerCase()}`;
    const fresh = c.req.query("refresh") === "1";
    const hit = fresh ? null : await store.fetch(cacheKey).catch(() => null);
    if (hit) return c.json(JSON.parse(hit));
    try {
      const report = await scanWallet(a as `0x${string}`, { client: getClient(4663), store, deniedTargets: await deniedTargets() });
      await rememberFlagged(store, a, report.approvals.filter((r) => r.risk !== "ok"));
      await store.put(cacheKey, JSON.stringify(report), 60).catch(() => {});
      return c.json(report);
    } catch (e) {
      return c.json({ error: "scan_failed", message: (e as Error).message.split("\n")[0] }, 502);
    }
  });

  // ── Guardian Points ─────────────────────────────────────────────────────────
  app.get("/v1/points/rules", (c) => c.json(RULES));
  app.get("/v1/points/leaderboard", async (c) => c.json(await leaderboard(store, Math.min(100, Number(c.req.query("limit") ?? 100)))));
  app.get("/v1/points/:address", async (c) => {
    const a = c.req.param("address");
    if (!isAddress(a)) return c.json({ error: "invalid_address" }, 400);
    return c.json(await walletPoints(store, a));
  });
  app.post("/v1/points/revoke", limitBody, async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { owner?: string; txHash?: string };
    if (!b.owner || !isAddress(b.owner) || !b.txHash || !/^0x[0-9a-fA-F]{64}$/.test(b.txHash)) return c.json({ error: "invalid_request" }, 400);
    try {
      return c.json(await claimRevoke(store, getClient(4663), b.owner as `0x${string}`, b.txHash as `0x${string}`));
    } catch (e) {
      return c.json({ error: "tx_not_found", message: (e as Error).message.split("\n")[0] }, 404);
    }
  });

  const sessionOwner = async (c: any) => {
    const h = c.req.header("authorization") ?? "";
    const token = h.startsWith("Session ") ? h.slice(8) : "";
    return token ? await store.fetch(`session:${createHash("sha256").update(token).digest("hex")}`) : null;
  };
  const isAdmin = (c: any) => {
    const want = env.SHIELD_ADMIN_KEY_SHA256;
    const got = c.req.header("x-admin-key");
    if (!want || !got) return false;
    const a = createHash("sha256").update(got).digest(); const b = Buffer.from(want, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  };

  app.post("/v1/reports", limitBody, async (c) => {
    const reporter = await sessionOwner(c);
    if (!reporter) return c.json({ error: "not_signed_in", message: "Sign in with your wallet to report an address." }, 401);
    const b = (await c.req.json().catch(() => ({}))) as { address?: string; evidence?: string; note?: string };
    if (!b.address || !isAddress(b.address)) return c.json({ error: "invalid_address" }, 400);
    if (!b.evidence || !/^https?:\/\/\S{6,300}$/.test(b.evidence)) return c.json({ error: "evidence_required", message: "Link a transaction, post or page that shows the theft." }, 400);
    const day = new Date().toISOString().slice(0, 10);
    if ((await store.incr(`reports:by:${reporter.toLowerCase()}:${day}`, 86_400)) > 10) return c.json({ error: "too_many_reports" }, 429);
    return c.json(await submitReport(store, { reporter, address: b.address, evidence: b.evidence, note: b.note?.slice(0, 500) }), 201);
  });
  app.get("/v1/reports", async (c) => (isAdmin(c) ? c.json(await listReports(store)) : c.json({ error: "forbidden" }, 403)));
  app.post("/v1/reports/:id/decision", async (c) => {
    if (!isAdmin(c)) return c.json({ error: "forbidden" }, 403);
    const { confirm } = (await c.req.json().catch(() => ({}))) as { confirm?: boolean };
    const r = await decideReport(store, c.req.param("id"), !!confirm, addCommunityBlock);
    if (r) await logDecision(store, { id: r.id, address: r.address, reporter: r.reporter, status: r.status, at: Date.now(), by: "admin" });
    return r ? c.json(r) : c.json({ error: "not_found" }, 404);
  });
  app.post("/v1/points/deposits", limitBody, async (c) => {
    if (!isAdmin(c)) return c.json({ error: "forbidden" }, 403);
    const b = (await c.req.json().catch(() => ({}))) as { day?: string; holdings?: Record<string, number> };
    if (!b.day || !/^\d{4}-\d{2}-\d{2}$/.test(b.day) || !b.holdings) return c.json({ error: "invalid_request" }, 400);
    return c.json({ awarded: await applyDepositSnapshot(store, b.day, b.holdings) });
  });

  // ── Agent Arena ─────────────────────────────────────────────────────────────
  app.get("/v1/arena", async (c) => {
    const seasons = await loadSeasons(store, env);
    const season = currentSeason(seasons);
    if (!season) return c.json({ season: null, seasons: [], standings: [] });
    const cacheKey = `arena:cache:${season.id}`;
    const hit = await store.fetch(cacheKey);
    if (hit) return c.json(JSON.parse(hit));
    const body = { season, seasons, standings: await standings(store, season) };
    await store.put(cacheKey, JSON.stringify(body), 120).catch(() => {});
    return c.json(body);
  });
  app.post("/v1/arena/snapshots", limitBody, async (c) => {
    if (!isAdmin(c)) return c.json({ error: "forbidden" }, 403);
    const b = (await c.req.json().catch(() => ({}))) as { at?: number; vaults?: Snapshot[] };
    if (!Array.isArray(b.vaults)) return c.json({ error: "invalid_request" }, 400);
    const rows = b.vaults.filter((r) => isAddress(r.vault) && Number.isFinite(r.pps) && r.pps > 0 && Number.isFinite(r.tvl));
    await recordSnapshots(store, b.at ?? Date.now(), rows);
    return c.json({ recorded: rows.length });
  });

  // ── Early access, referrals and verified actions ──────────────────────────────
  app.get("/v1/early", async (c) => c.json(await earlyStatus(store, env)));
  app.post("/v1/early", limitBody, async (c) => {
    const owner = await sessionOwner(c);
    if (!owner) return c.json({ error: "not_signed_in", message: "Sign in with your wallet first." }, 401);
    const b = (await c.req.json().catch(() => ({}))) as { code?: string };
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
    const r = await registerEarly(store, getClient(4663), owner, { ipKey: ipKey(ip), code: typeof b.code === "string" ? b.code : undefined, env });
    return c.json(r, r.ok ? 200 : r.error === "too_many" ? 429 : 400);
  });
  app.get("/v1/early/:address", async (c) => {
    const a = c.req.param("address");
    if (!isAddress(a)) return c.json({ error: "invalid_address" }, 400);
    const rec = await store.fetch(`early:${a.toLowerCase()}`);
    return c.json({ registered: !!rec, ...(rec ? { at: (JSON.parse(rec) as { at: number }).at } : {}) });
  });
  app.get("/v1/referrals/:address", async (c) => {
    const a = c.req.param("address");
    return isAddress(a) ? c.json(await referralStats(store, a)) : c.json({ error: "invalid_address" }, 400);
  });
  app.post("/v1/referrals/bind", limitBody, async (c) => {
    const owner = await sessionOwner(c);
    if (!owner) return c.json({ error: "not_signed_in" }, 401);
    const b = (await c.req.json().catch(() => ({}))) as { code?: string };
    const r = await bindReferral(store, owner, String(b.code ?? ""));
    return c.json(r, r.ok ? 200 : 400);
  });
  app.post("/v1/points/action", limitBody, async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { owner?: string; txHash?: string };
    if (!b.owner || !isAddress(b.owner) || !b.txHash || !/^0x[0-9a-fA-F]{64}$/.test(b.txHash)) return c.json({ error: "invalid_request" }, 400);
    try { return c.json(await claimAction(store, getClient(4663), b.owner as `0x${string}`, b.txHash as `0x${string}`, env)); }
    catch (e) { return c.json({ error: "tx_not_found", message: (e as Error).message.split("\n")[0] }, 404); }
  });

  // ── Wallet Watch (browser push) ───────────────────────────────────────────────
  app.get("/v1/watch/vapid", (c) => (env.VAPID_PUBLIC_KEY ? c.json({ publicKey: env.VAPID_PUBLIC_KEY }) : c.json({ error: "not_configured" }, 503)));
  app.post("/v1/watch", limitBody, async (c) => {
    if (!env.VAPID_PUBLIC_KEY) return c.json({ error: "not_configured", message: "Wallet Watch is not switched on yet." }, 503);
    const b = (await c.req.json().catch(() => ({}))) as { address?: string; subscription?: unknown };
    if (!b.address || !isAddress(b.address) || !validSubscription(b.subscription)) return c.json({ error: "invalid_request" }, 400);
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
    if ((await store.incr(`watch:rl:${ipKey(ip)}`, 3_600)) > 20) return c.json({ error: "too_many_requests" }, 429);
    const r = await subscribe(store, b.address, b.subscription);
    return c.json(r, r.ok ? 200 : 400);
  });
  app.delete("/v1/watch", limitBody, async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { endpoint?: string; address?: string };
    if (!b.endpoint || typeof b.endpoint !== "string") return c.json({ error: "invalid_request" }, 400);
    return c.json(await unsubscribe(store, b.endpoint, b.address && isAddress(b.address) ? b.address : undefined));
  });
  const watchScan = async (address: string) => {
    const report = await scanWallet(address as `0x${string}`, { client: getClient(4663), store, quick: true, deniedTargets: await deniedTargets() });
    await rememberFlagged(store, address, report.approvals.filter((r) => r.risk !== "ok")).catch(() => {});
    return report;
  };

  // ── Public status ─────────────────────────────────────────────────────────────
  app.get("/v1/status", async (c) => {
    const body = await memo("status", 30, () => status(store, async () => { const b = await getClient(4663).getBlock(); return { block: b.number!, timestamp: b.timestamp, provider: activeProvider(4663) ?? undefined }; }));
    c.header("cache-control", "public, max-age=30, s-maxage=30");
    return c.json(body);
  });

  // ── Admin panel (x-admin-key) ───────────────────────────────────────────────
  const admin = (handler: (c: any) => Promise<Response>) => async (c: any) => (isAdmin(c) ? handler(c) : c.json({ error: "forbidden" }, 403));
  app.get("/v1/admin/overview", admin(async (c) => {
    const [checks, allowed, warned, denied] = await Promise.all(["checks", "allowed", "warned", "denied"].map((k) => store.get(`stats:${k}`)));
    const seasons = await loadSeasons(store, env);
    return c.json({
      stats: { checks, allowed, warned, denied },
      pendingReports: (await store.members("reports:pending")).length,
      communityBlocklist: communityEntries().length,
      season: currentSeason(seasons),
      seasonsSource: (await store.fetch("arena:seasons")) ? "admin" : "env",
    });
  }));
  app.get("/v1/admin/decisions", admin(async (c) => c.json(await recentDecisions(store))));
  app.get("/v1/admin/blocklist", admin(async (c) => c.json(communityEntries())));
  app.delete("/v1/admin/blocklist/:address", admin(async (c) => {
    const a = c.req.param("address");
    if (!isAddress(a)) return c.json({ error: "invalid_address" }, 400);
    const removed = removeCommunityBlock(a);
    await store.removeMember("blocklist:community", a.toLowerCase());
    if (removed) await logDecision(store, { id: "-", address: a.toLowerCase(), reporter: "-", status: "unblocked", at: Date.now(), by: "unblock" });
    return c.json({ removed });
  }));
  app.get("/v1/admin/arena/seasons", admin(async (c) => c.json(await loadSeasons(store, env))));
  app.put("/v1/admin/arena/seasons", limitBody, admin(async (c) => {
    const v = validateSeasons(await c.req.json().catch(() => null));
    if (!v.ok) return c.json({ error: "invalid_seasons", message: v.error }, 400);
    await saveSeasons(store, v.seasons, await loadSeasons(store, env));
    return c.json(v.seasons);
  }));
  app.post("/v1/admin/watch/run", admin(async (c) => {
    // browser push needs VAPID keys; developer webhooks run either way
    const send = await webPushSender(env);
    const site = env.HEIMDALL_WEB_URL ?? "https://heimdall.fund";
    return c.json(await runWatch(store, watchScan, send, {
      limit: Math.min(500, Number(c.req.query("limit") ?? 200)), siteUrl: site,
      onRisky: async (address, fresh) => {
        for (const owner of await hookOwnersOf(store, address)) {
          await deliver(store, owner, "wallet.risky_approval", { wallet: address, approvals: fresh, reportUrl: `${site}/check/${address}` }, fetch, { allowInsecure: hookInsecure });
        }
      },
    }));
  }));
  app.post("/v1/admin/heartbeat", limitBody, admin(async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { service?: string; probes?: Record<string, boolean>; detail?: string };
    if (b.service !== "monitor" && b.service !== "keeper") return c.json({ error: "invalid_service" }, 400);
    const probes = Object.fromEntries(Object.entries(b.probes ?? {}).filter(([k, v]) => (k === "shield" || k === "rpc") && typeof v === "boolean"));
    await recordHeartbeat(store, b.service, probes, b.detail);
    return c.body(null, 204);
  }));
  app.get("/v1/admin/incidents", admin(async (c) => c.json(await listIncidents(store))));
  app.post("/v1/admin/incidents", limitBody, admin(async (c) => {
    const r = await upsertIncident(store, (await c.req.json().catch(() => ({}))) as Record<string, string>);
    if (r.ok) await store.remove("memo:status").catch(() => {});
    return c.json(r, r.ok ? 200 : 400);
  }));
  app.get("/v1/admin/growth", admin(async (c) => c.json(await growthStats(store, Math.min(60, Number(c.req.query("days") ?? 14))))));
  app.get("/v1/admin/analytics", admin(async (c) => c.json(await analytics(store, Number(c.req.query("days") ?? 14)))));

  // ── Privacy-friendly analytics: an allowlisted event name and a path with ids stripped; nothing about the visitor.
  app.post("/v1/events", bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) }), async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: unknown; path?: unknown };
    const ok = await trackEvent(store, b.name, b.path).catch(() => false);
    return c.body(null, ok ? 204 : 202);
  });

  // community blocklist survives restarts
  store.members("blocklist:community").then((m) => m.forEach(addCommunityBlock)).catch(() => {});

  app.route("/v1", keysRoutes(store, () => getClient(4663), { allowInsecureHooks: hookInsecure }));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  const port = Number(process.env.PORT ?? 8787);
  getSigner().then((s) => {
    if (s.kind === "ephemeral") console.warn("[shield] no signer configured — using an EPHEMERAL key (dev only)", s.address);
    else console.log(`[shield] receipt signer (${s.kind})`, s.address);
    serve({ fetch: buildApp().fetch, port });
    console.log(`[shield] listening on :${port}`);
  }).catch((e) => {
    console.error("[shield] refusing to start:", (e as Error).message);
    process.exit(1);
  });
}
