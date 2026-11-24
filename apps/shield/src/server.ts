import { agentStats, loadVerdict, recordCheck, saveVerdict, threats } from "./insights.js";
import { scanWallet } from "./approvals.js";
import { currentSeason, recordSnapshots, standings, type Snapshot } from "./arena.js";
import { openApi } from "./openapi.js";
import { agentCard, handleA2A } from "./a2a.js";
import { tokenCheck } from "./tokencheck.js";
import { explorerHoldings, flagHoldings } from "./holdings.js";
import { countVerdict, listIncidents, recordHeartbeat, status, upsertIncident } from "./status.js";
import { runWatch, subscribe, unsubscribe, validSubscription, webPushSender } from "./watch.js";
import { bindReferral, claimAction, earlyStatus, growthStats, ipKey, referralStats, registerEarly } from "./growth.js";
import { analytics, loadSeasons, logDecision, recentDecisions, saveSeasons, trackEvent, validateSeasons } from "./admin.js";
import { addCommunityBlock, blocklistEntries, communityEntries, removeCommunityBlock } from "./blocklist.js";
import { decodeHeader, discovery, encodeHeader, normalizePayload, paymentRequired, rememberResource, requirementsFor, ROBINHOOD_USDG, settlePayment, verifyPayment, type DiscoveryItem, type PaymentPayload, type PaymentRequirements } from "./x402.js";
import { createWalletClient, custom, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodMainnet } from "./chains.js";
import { isBlocklisted } from "./blocklist.js";
import { feedbackFile, feedbackHash, linkedAddress, linkedAgentId, linkIdentity, onchainReputation, payRecord, readIdentity, scorePassport, type Identity } from "./passport.js";
import { describe as describeRisk, flagNames, LEVEL_NAME, readOracle, riskList, type RiskEntry } from "./risk.js";
import { applyDepositSnapshot, claimRevoke, countCheck, decideReport, leaderboard, listReports, rememberFlagged, RULES, submitReport, walletPoints } from "./points.js";
import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { createPublicClient, fallback, getAddress, http, isAddress, isHex, keccak256, toHex, type PublicClient } from "viem";
import { z } from "zod";
import { SUPPORTED_CHAINS, type SupportedChainId } from "./chains.js";
import { PolicySchema } from "./policy.js";
import { receiptDomain, RECEIPT_TYPES } from "./receipt.js";
import { getSigner, prelaunch } from "./signer.js";
import { checkTransaction, toJSON } from "./shield.js";
import { checkAuthorization, checkPersonalMessage, checkTypedData } from "./typed.js";
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
const Authorization7702 = z.object({
  chainId: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,20}$/)]),
  address: addr,
  nonce: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,20}$/)]).optional(),
});

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
  /** EIP-7702 authorization tuple the wallet is asked to sign. */
  authorization: Authorization7702.optional(),
  policy: PolicySchema.optional(),
  share: z.boolean().optional(),
}).refine((b) => [b.typedData, b.message, b.authorization].filter((x) => x !== undefined).length === 1, "send exactly one of typedData, message or authorization");

export const CheckBody = z.object({
  chainId: z.union([z.literal(4663), z.literal(46630)]).default(4663),
  from: addr,
  to: addr.nullable().optional(),
  data: z.string().refine((v) => isHex(v), "data must be hex").max(65_536).default("0x"),
  value: z.union([z.string().regex(/^(0x[0-9a-fA-F]{1,64}|\d{1,78})$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).default("0").refine((v) => BigInt(v) < 2n ** 256n, "value must fit in uint256"),
  policy: PolicySchema.optional(),
  share: z.boolean().optional(),
  /** EIP-7702 (type 4) transaction: the authorizations it carries. */
  authorizationList: z.array(Authorization7702).max(8).optional(),
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

type Vars = { Variables: { caller: Caller; paid: boolean } };

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
  // a hard ceiling for every route; check routes use the tighter limitBody (128 KB)
  app.use("*", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) }));
  app.use("*", cors({ origin: origins.includes("*") ? "*" : origins, allowHeaders: ["content-type", "authorization", "x-api-key", "x-admin-key", "payment-signature", "x-payment"], exposeHeaders: ["payment-required", "payment-response", "x-payment-response", "x-ratelimit-remaining", "x-heimdall-quota-remaining"], maxAge: 600 }));
  app.use("*", async (c, next) => {
    const t = Date.now();
    await next();
    log({ t: new Date(t).toISOString(), method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - t, caller: c.get("caller")?.id });
  });

  app.get("/health", async (c) => {
    const t = Date.now();
    try {
      const block = await getClient(4663).getBlockNumber();
      return c.json({ ok: true, service: "heimdall-shield", version: "0.2.0", mode: prelaunch(env) ? "prelaunch" : "live", block: block.toString(), rpcMs: Date.now() - t });
    } catch {
      return c.json({ ok: false, service: "heimdall-shield", version: "0.2.0", error: "rpc_unreachable" }, 503);
    }
  });

  /** OpenAPI 3.1 for the public API, open to any origin so agents, SDK generators and API catalogs can read it. */
  let spec: string | null = null;
  app.get("/openapi.json", (c) => {
    spec ??= JSON.stringify(openApi(env.SHIELD_PUBLIC_URL ?? "https://api.heimdall.fund"));
    c.header("access-control-allow-origin", "*");
    c.header("cache-control", "public, max-age=3600");
    return c.body(spec, 200, { "content-type": "application/json" });
  });

  app.get("/v1/stats", async (c) => {
    const [checks, allowed, warned, denied] = await Promise.all(["checks", "allowed", "warned", "denied"].map((k) => store.get(`stats:${k}`)));
    return c.json({ checks, allowed, warned, denied });
  });

  app.get("/v1/signer", async (c) => {
    if (prelaunch(env)) return c.json({ signer: null, kind: "prelaunch", domain: receiptDomain(4663), types: RECEIPT_TYPES });
    const s = await getSigner(env);
    return c.json({ signer: s.address, kind: s.kind, domain: receiptDomain(4663), types: RECEIPT_TYPES });
  });

  // ── x402: pay per call in USDG instead of an API key ──────────────────────────
  const X402_ON = !!(env.X402_PAY_TO && isAddress(env.X402_PAY_TO) && env.X402_FACILITATOR_KEY);
  /** USDG on Robinhood Chain. X402_ASSET overrides the token for local tests only. */
  const NET = env.X402_ASSET && isAddress(env.X402_ASSET) ? { ...ROBINHOOD_USDG, asset: env.X402_ASSET as `0x${string}` } : ROBINHOOD_USDG;
  const PRICE = {
    check: BigInt(env.X402_PRICE_CHECK ?? "1000"), // 0.001 USDG
    wallet: BigInt(env.X402_PRICE_WALLET ?? "2000"), // 0.002 USDG
  };
  const publicApi = (env.SHIELD_PUBLIC_URL ?? "https://api.heimdall.fund").replace(/\/$/, "");
  let facilitator: WalletClient | null = null;
  const facilitatorWallet = () => {
    if (!env.X402_FACILITATOR_KEY) return null;
    facilitator ??= createWalletClient({
      account: privateKeyToAccount(env.X402_FACILITATOR_KEY as `0x${string}`),
      chain: robinhoodMainnet,
      transport: custom({ request: (args) => getClient(4663).request(args as never) }),
    });
    return facilitator;
  };
  /** Heimdall's own check before any payment is settled: never pay a blocked address. */
  const recipientBlocked = async (a: string) => isBlocklisted(a) || (await riskEntries()).some((e) => e.level >= 3 && e.address.toLowerCase() === a.toLowerCase());
  const ownRequirements = (price: bigint) => requirementsFor(NET, price, env.X402_PAY_TO as `0x${string}`);
  const RESOURCES: Record<string, { description: string; price: () => bigint; method: string }> = {
    "/v1/check": { description: "Heimdall Shield: simulate and judge a transaction before an agent signs it (ALLOW / WARN / DENY + EIP-712 receipt)", price: () => PRICE.check, method: "POST" },
    "/v1/check-signature": { description: "Heimdall Shield: judge an EIP-712 or personal_sign request (Permit, Permit2, orders) before signing", price: () => PRICE.check, method: "POST" },
    "/v1/wallet": { description: "Heimdall Wallet Check: every live token approval of a Robinhood Chain wallet, ranked by risk", price: () => PRICE.wallet, method: "GET" },
  };
  const resourceInfo = (path: string) => {
    const key = Object.keys(RESOURCES).find((k) => path === k || path.startsWith(`${k}/`)) ?? path;
    return { url: `${publicApi}${path}`, description: RESOURCES[key]?.description, mimeType: "application/json", serviceName: "Heimdall Shield", tags: ["security", "ai-agents", "robinhood-chain"] };
  };
  /** 402 with the PAYMENT-REQUIRED header (x402 v2) and the same object in the body. */
  function paymentRequiredResponse(c: any, price: bigint, error: string, message: string) {
    const pr = paymentRequired(resourceInfo(c.req.path), [ownRequirements(price)], error);
    c.header("PAYMENT-REQUIRED", encodeHeader(pr));
    return c.json({ ...pr, message }, 402);
  }
  /** A PAYMENT-SIGNATURE (or v1 X-PAYMENT) header: settle it, then serve the request as a paid call. */
  async function payWithX402(c: any, price: bigint): Promise<Response | "paid" | null> {
    const raw = c.req.header("payment-signature") ?? c.req.header("x-payment");
    const wallet = facilitatorWallet();
    if (!raw || !X402_ON || !wallet) return null;
    const req = ownRequirements(price);
    const p = normalizePayload(decodeHeader(raw), req, NET);
    if (!p) return paymentRequiredResponse(c, price, "invalid_payload", "The payment header could not be read.");
    // one payment buys one call: a replayed PAYMENT-SIGNATURE is refused even though settlement itself is idempotent
    const used = `x402:consumed:${String(p.payload.authorization.from).toLowerCase()}:${p.payload.authorization.nonce}`;
    // atomic claim first, so two concurrent requests with the same payment cannot both be served
    if ((await store.incr(used, 30 * 86_400)) > 1) return paymentRequiredResponse(c, price, "payment_already_used", "This payment was already used for a call. Sign a new one.");
    const r = await settlePayment(wallet, getClient(4663), p, req, { net: NET, store, recipientBlocked, minAmount: price });
    if (!r.success) {
      await store.remove(used).catch(() => {}); // nothing was paid: the agent may fix it and retry
      return paymentRequiredResponse(c, price, r.errorReason ?? "payment_failed", "The payment was not accepted.");
    }
    await store.incr("x402:own:calls", 400 * 86_400).catch(() => 0);
    c.set("caller", { id: `x402:${r.payer?.toLowerCase()}`, plan: "pro" } satisfies Caller);
    c.set("paid", true);
    c.header("PAYMENT-RESPONSE", encodeHeader(r));
    return "paid";
  }

  /** API key → per-minute rate limit → (after validation) free daily quota per wallet. A paid x402 call skips both. */
  async function admit(c: any, price?: bigint): Promise<Response | null> {
    if (price !== undefined) {
      const paid = await payWithX402(c, price);
      if (paid === "paid") return null;
      if (paid) return paid;
    }
    const auth = c.req.header("authorization");
    const apiKey = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : c.req.header("x-api-key") ?? undefined;
    const ip = clientIp(c, "unknown");
    const caller = await resolveCaller(apiKey, ip);
    if (!caller) return c.json({ error: "invalid_api_key" }, 401);
    if (caller.plan === "free" && limits.requireKey) {
      return X402_ON && price !== undefined ? paymentRequiredResponse(c, price, "api_key_required", "Use an API key, or pay per call with x402 (USDG on Robinhood Chain).") : c.json({ error: "api_key_required" }, 401);
    }
    c.set("caller", caller);
    const rate = await checkRate(store, limits, caller);
    c.header("x-ratelimit-limit", String(rate.limit));
    c.header("x-ratelimit-remaining", String(rate.remaining));
    if (!rate.ok) {
      c.header("retry-after", String(rate.retryAfter ?? 60));
      if (X402_ON && price !== undefined && caller.plan === "free") return paymentRequiredResponse(c, price, "rate_limited", "Free limit reached. Pay per call with x402 (USDG on Robinhood Chain), or use an API key.");
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

  async function quota(c: any, wallet: string, price?: bigint): Promise<Response | null> {
    if (c.get("paid")) return null;
    const caller = c.get("caller") as Caller;
    const mult = caller.plan === "free" ? await holderMultiplier(wallet) : 1;
    if (mult > 1) c.header("x-heimdall-holder", "true");
    const q = await checkDailyQuota(store, limits, caller, wallet, Date.now(), mult);
    if (Number.isFinite(q.remaining)) c.header("x-heimdall-quota-remaining", String(q.remaining));
    if (!q.ok) {
      if (X402_ON && price !== undefined && caller.plan === "free") return paymentRequiredResponse(c, price, "daily_quota_exceeded", `Free plan: ${q.limit} checks per wallet per day. Pay per call with x402 (USDG), or use an API key.`);
      return c.json({ error: "daily_quota_exceeded", message: `Free plan: ${q.limit} checks per wallet per day. Use an API key to continue.` }, 429);
    }
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
    // validate before admitting, so a paid (x402) call is never charged for a malformed request
    const parsed = SignatureBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    const denied = await admit(c, PRICE.check);
    if (denied) return denied;
    const b = parsed.data;
    const over = await quota(c, b.signer, PRICE.check);
    if (over) return over;
    const policy = PolicySchema.parse(b.policy ?? {});
    try {
      const result = b.typedData
        ? await checkTypedData(b.chainId, b.signer as `0x${string}`, b.typedData as never, policy, getClient(b.chainId))
        : b.authorization
          ? await checkAuthorization(b.chainId, b.authorization, policy, getClient(b.chainId))
          : checkPersonalMessage(b.message!, policy);
      const bucket = result.verdict === "ALLOW" ? "allowed" : result.verdict === "WARN" ? "warned" : "denied";
      await countVerdict(store, bucket).catch(() => {});
      const checkId = keccak256(toHex(`sig:${b.signer}:${Date.now()}:${Math.random()}`));
      const spender = result.approvals?.[0]?.spender ?? null;
      await recordCheck(store, { kind: "sig", wallet: b.signer, target: spender, result: { ...result, checkId } }).catch(() => {});
      if (b.share) await saveVerdict(store, checkId, { kind: "sig", at: Date.now(), chainId: b.chainId, signer: b.signer, primaryType: b.typedData?.primaryType ?? (b.authorization ? "EIP7702Authorization" : "personal_sign"), result: toJSON(result) }).catch(() => {});
      notifyVerdict(c, "sig", { ...result, checkId } as never, { chainId: b.chainId, signer: b.signer, primaryType: b.typedData?.primaryType ?? (b.authorization ? "EIP7702Authorization" : "personal_sign") });
      return c.json(b.share ? { ...(toJSON(result) as object), shareId: checkId } : result);
    } catch (e) {
      log({ level: "error", path: "/v1/check-signature", message: (e as Error).message });
      return c.json({ error: "check_failed", message: "Shield could not complete the check. Do not sign." }, 500);
    }
  });

  app.post("/v1/check", limitBody, async (c) => {
    // validate before admitting, so a paid (x402) call is never charged for a malformed request
    const parsed = CheckBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    const denied = await admit(c, PRICE.check);
    if (denied) return denied;
    const b = parsed.data;
    const over = await quota(c, b.from, PRICE.check);
    if (over) return over;

    // 5. check
    try {
      const peersKey = `agent:${b.from.toLowerCase()}:peers`;
      const history = b.probe ? [] : await store.members(peersKey).catch(() => [] as string[]);
      const result = await checkTransaction(
        { chainId: b.chainId, from: b.from as `0x${string}`, to: (b.to ?? null) as `0x${string}` | null, data: b.data as `0x${string}`, value: BigInt(b.value), authorizationList: b.authorizationList },
        b.policy,
        { client: getClient(b.chainId), history },
      );
      // Remember where this wallet sends and what it approves, but only from clean checks: a poisoned address
      // must never become "familiar". Capped so one wallet cannot grow its set without limit.
      if (!b.probe && result.verdict === "ALLOW" && history.length < 200) {
        const peers = new Set<string>();
        if (b.to) peers.add(b.to.toLowerCase());
        for (const a of result.approvals) if (!a.revoke) peers.add(a.spender.toLowerCase());
        for (const ch of result.assetChanges) if (ch.delta < 0n) for (const p of ch.counterparties) peers.add(p.toLowerCase());
        await Promise.all([...peers].map((p) => store.addMember(peersKey, p))).catch(() => {});
      }
      const bucket = result.verdict === "ALLOW" ? "allowed" : result.verdict === "WARN" ? "warned" : "denied";
      await countVerdict(store, bucket).catch(() => {});
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

  // ── A2A: other agents send a task (check a transaction, a signature or an address) ──
  app.get("/.well-known/agent-card.json", (c) => {
    c.header("access-control-allow-origin", "*");
    c.header("cache-control", "public, max-age=3600");
    return c.json(agentCard(env.SHIELD_PUBLIC_URL ?? "https://api.heimdall.fund"));
  });
  app.post("/a2a", limitBody, async (c) => {
    const rpc = await c.req.json().catch(() => null);
    if (!rpc || typeof rpc !== "object" || Array.isArray(rpc)) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    // The task runs through the public route with the caller's own headers: same IP, key, x402 payment and quota.
    const pass = ["x-forwarded-for", "x-real-ip", "authorization", "x-api-key", "payment-signature", "x-payment", "x-heimdall-relay", "x-heimdall-client-ip"];
    const headers: Record<string, string> = {};
    for (const h of pass) { const v = c.req.header(h); if (v) headers[h] = v; }
    const call = async (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
    c.header("access-control-allow-origin", "*");
    return c.json(await handleA2A(rpc, call) as Record<string, unknown>);
  });

  /** Token Check: simulated buy, sell and transfer of a token through its Uniswap pool, plus backdoor and fake-token tests. */
  /** Token Check with the shared one-minute cache (also used by Wallet Check). */
  async function cachedTokenCheck(token: `0x${string}`) {
    const key = `tokencheck:${token.toLowerCase()}`;
    const hit = await store.fetch(key).catch(() => null);
    if (hit) return JSON.parse(hit) as Awaited<ReturnType<typeof tokenCheck>>;
    const r = await tokenCheck(getClient(4663), token);
    await store.put(key, JSON.stringify(r), 60).catch(() => {});
    return r;
  }

  app.get("/v1/token/:address", async (c) => {
    const a = c.req.param("address");
    if (!isAddress(a)) return c.json({ error: "invalid_address" }, 400);
    const key = `tokencheck:${a.toLowerCase()}`;
    const hit = await store.fetch(key).catch(() => null);
    c.header("cache-control", "public, max-age=60");
    if (hit) return c.json(JSON.parse(hit));
    // four simulations per token: counted like a check, but a cached answer is free
    const denied = await admit(c, PRICE.check);
    if (denied) return denied;
    try {
      const r = await tokenCheck(getClient(4663), a as `0x${string}`);
      await store.put(key, JSON.stringify(r), 60).catch(() => {});
      return c.json(r);
    } catch (e) {
      log({ level: "error", path: "/v1/token", message: (e as Error).message });
      return c.json({ error: "check_failed", message: "Token Check could not complete. Treat the token as unsafe." }, 500);
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

  // ── Risk Oracle ─────────────────────────────────────────────────────────────
  const riskEntries = () => memo<RiskEntry[]>("risklist", 60, async () => {
    const board = await memo("threats", 60, () => threats(store));
    return riskList(board.targets);
  });

  /** Everything the onchain Risk Oracle should hold; the monitor's riskSync job writes it. Public, like the Threat Board. */
  app.get("/v1/risk", async (c) => {
    c.header("cache-control", "public, max-age=30, s-maxage=60");
    const list = await riskEntries();
    return c.json({
      chainId: 4663,
      oracle: env.RISK_ORACLE_ADDRESS ?? null,
      count: list.length,
      entries: list.map((e) => ({ ...e, levelName: LEVEL_NAME[e.level], flagNames: flagNames(e.flags) })),
    });
  });

  app.get("/v1/risk/:address", async (c) => {
    const a = c.req.param("address");
    if (!isAddress(a)) return c.json({ error: "invalid_address" }, 400);
    const list = await riskEntries();
    const entry = list.find((e) => e.address.toLowerCase() === a.toLowerCase());
    const onchain = await readOracle(getClient(4663), env.RISK_ORACLE_ADDRESS, a as `0x${string}`);
    c.header("cache-control", "public, max-age=30");
    return c.json({ ...describeRisk(entry, a as `0x${string}`), oracle: env.RISK_ORACLE_ADDRESS ?? null, onchain });
  });

  // ── x402 facilitator (any x402 server on Robinhood Chain) ───────────────────
  const facilitatorBody = z.object({ x402Version: z.number().optional(), paymentPayload: z.unknown(), paymentRequirements: z.object({
    scheme: z.literal("exact"), network: z.string(), amount: z.string().optional(), maxAmountRequired: z.string().optional(),
    asset: z.string(), payTo: z.string(), maxTimeoutSeconds: z.number().default(60), extra: z.record(z.string(), z.unknown()).optional(),
  }).passthrough() });
  const toRequirements = (r: z.infer<typeof facilitatorBody>["paymentRequirements"]): PaymentRequirements | null => {
    const amount = r.amount ?? r.maxAmountRequired;
    if (!amount || !isAddress(r.asset) || !isAddress(r.payTo)) return null;
    const network = r.network === NET.legacyNetwork ? NET.network : r.network;
    return { scheme: "exact", network, amount, asset: r.asset, payTo: r.payTo, maxTimeoutSeconds: r.maxTimeoutSeconds, extra: r.extra };
  };
  const minSettle = BigInt(env.X402_MIN_SETTLE ?? "1000");

  app.get("/x402/supported", (c) => {
    const w = facilitatorWallet();
    if (!w) return c.json({ error: "not_configured", message: "The facilitator goes live with the mainnet launch." }, 503);
    return c.json({
      kinds: [
        { x402Version: 2, scheme: "exact", network: NET.network, extra: { asset: NET.asset, name: NET.name, version: NET.version } },
        { x402Version: 1, scheme: "exact", network: NET.legacyNetwork },
      ],
      extensions: ["bazaar", "heimdall-recipient-check"],
      signers: { "eip155:*": [w.account!.address] },
    });
  });

  app.post("/x402/verify", limitBody, async (c) => {
    const parsed = facilitatorBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ isValid: false, invalidReason: "invalid_payload" }, 400);
    const req = toRequirements(parsed.data.paymentRequirements);
    const p = req && normalizePayload(parsed.data.paymentPayload, req, NET);
    if (!req || !p) return c.json({ isValid: false, invalidReason: "invalid_payload" }, 400);
    return c.json(await verifyPayment(getClient(4663), p, req, { net: NET, recipientBlocked, minAmount: minSettle }));
  });

  app.post("/x402/settle", limitBody, async (c) => {
    const w = facilitatorWallet();
    if (!w) return c.json({ success: false, errorReason: "not_configured", transaction: "", network: NET.network }, 503);
    // settling costs gas: a per-IP limit stops anyone from making the facilitator burn it
    const ip = clientIp(c, "unknown");
    const rate = await checkRate(store, { ...limits, freePerMinute: Number(env.X402_SETTLE_RPM ?? 120) }, { id: `x402settle:${ip}`, plan: "free" } as Caller);
    if (!rate.ok) return c.json({ success: false, errorReason: "rate_limited", transaction: "", network: NET.network }, 429);
    const parsed = facilitatorBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ success: false, errorReason: "invalid_payload", transaction: "", network: NET.network }, 400);
    const req = toRequirements(parsed.data.paymentRequirements);
    const p = req && normalizePayload(parsed.data.paymentPayload, req, NET);
    if (!req || !p) return c.json({ success: false, errorReason: "invalid_payload", transaction: "", network: NET.network }, 400);
    const r = await settlePayment(w, getClient(4663), p, req, {
      net: NET, store, recipientBlocked, minAmount: minSettle,
      onSettled: async (res, payload) => {
        await Promise.all([store.incr("x402:settled", 400 * 86_400), store.incr("x402:volume", 400 * 86_400, Number(res.amount ?? 0)), rememberResource(store, payload, req)]).catch(() => {});
      },
    });
    return c.json(r, r.success ? 200 : 400);
  });

  const ownDiscovery = (): DiscoveryItem[] => X402_ON ? Object.entries(RESOURCES).map(([path, r]) => ({
    resource: `${publicApi}${path}${path === "/v1/wallet" ? "/{address}" : ""}`, type: "http", x402Version: 2, accepts: [ownRequirements(r.price())],
    lastUpdated: new Date().toISOString(), metadata: { description: r.description, method: r.method, mimeType: "application/json", serviceName: "Heimdall Shield" },
  })) : [];
  const discoveryRoute = async (c: any) => {
    c.header("cache-control", "public, max-age=60");
    return c.json(await discovery(store, ownDiscovery(), { limit: Number(c.req.query("limit") ?? 20), offset: Number(c.req.query("offset") ?? 0), payTo: c.req.query("payTo") ?? undefined }));
  };
  app.get("/x402/discovery/resources", discoveryRoute);
  app.get("/discovery/resources", discoveryRoute);

  app.get("/x402/stats", async (c) => {
    const [settled, volume, ownCalls] = await Promise.all([store.get("x402:settled"), store.get("x402:volume"), store.get("x402:own:calls")]);
    return c.json({ enabled: X402_ON, network: NET.network, asset: NET.asset, settled, volumeUsdg: volume / 1e6, paidShieldCalls: ownCalls, prices: { check: String(PRICE.check), wallet: String(PRICE.wallet) } });
  });

  // ── Agent Passport (Heimdall Score + ERC-8004) ─────────────────────────────
  /** Official ERC-8004 registries on Robinhood Chain; ERC8004_* override them for local tests only. */
  const IDENTITY = (env.ERC8004_IDENTITY && isAddress(env.ERC8004_IDENTITY) ? env.ERC8004_IDENTITY : undefined) as `0x${string}` | undefined;
  const REPUTATION = (env.ERC8004_REPUTATION && isAddress(env.ERC8004_REPUTATION) ? env.ERC8004_REPUTATION : undefined) as `0x${string}` | undefined;
  async function passport(address: `0x${string}`, agentIdHint?: bigint | null) {
    const client = getClient(4663);
    const a = address.toLowerCase();
    const linked = await linkedAgentId(store, a);
    const agentId = linked ?? agentIdHint ?? null;
    const [shield, pay, txCount, list, identity] = await Promise.all([
      agentStats(store, a),
      payRecord(client, env.HEIMDALL_PAY_ADDRESS, address),
      client.getTransactionCount({ address }).catch(() => null),
      riskEntries(),
      agentId !== null ? readIdentity(client, agentId, fetch, IDENTITY) : Promise.resolve(null as Identity | null),
    ]);
    // an unlinked hint only counts when the chain says this address owns or operates that agent
    const verified = identity && (linked !== null || identity.owner.toLowerCase() === a || identity.wallet?.toLowerCase() === a) ? identity : null;
    const risk = list.find((e) => e.address.toLowerCase() === a);
    const s = scorePassport({ shield, pay, riskLevel: risk?.level ?? 0, txCount });
    const reputation = verified ? await onchainReputation(client, BigInt(verified.agentId), env.PASSPORT_PUBLISHER_ADDRESS, REPUTATION) : null;
    return {
      address, agentId: verified?.agentId ?? null, identity: verified, linked: linked !== null,
      ...s,
      shield, pay, risk: describeRisk(risk, address), txCount, reputation,
      publisher: env.PASSPORT_PUBLISHER_ADDRESS ?? null,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Passport by address, or by ERC-8004 agentId (number). */
  app.get("/v1/passport/:id", async (c) => {
    const id = c.req.param("id");
    let address: `0x${string}` | null = null;
    let hint: bigint | null = null;
    if (isAddress(id)) {
      address = id as `0x${string}`;
      const q = c.req.query("agentId");
      if (q && /^\d{1,30}$/.test(q)) hint = BigInt(q);
    } else if (/^\d{1,30}$/.test(id)) {
      hint = BigInt(id);
      address = (await linkedAddress(store, hint)) ?? null;
      if (!address) {
        const ident = await readIdentity(getClient(4663), hint, fetch, IDENTITY);
        if (!ident) return c.json({ error: "agent_not_found" }, 404);
        address = (ident.wallet ?? ident.owner) as `0x${string}`;
      }
    } else return c.json({ error: "invalid_id", message: "Use a 0x address or an ERC-8004 agentId." }, 400);
    c.header("cache-control", "public, max-age=60");
    return c.json(await memo(`passport:${address.toLowerCase()}:${hint ?? ""}`, 120, () => passport(address!, hint)));
  });

  /** Link an ERC-8004 agentId to a wallet. Anyone may ask; it only succeeds when the chain confirms ownership. */
  app.post("/v1/passport/link", limitBody, async (c) => {
    const b = z.object({ address: addr, agentId: z.union([z.string().regex(/^\d{1,30}$/), z.number().int().nonnegative()]) }).safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json({ error: "invalid_request", issues: b.error.issues }, 400);
    const r = await linkIdentity(store, getClient(4663), b.data.address as `0x${string}`, BigInt(b.data.agentId), IDENTITY);
    if (!r.ok) return c.json({ error: r.reason }, r.reason === "agent_not_found" ? 404 : 403);
    await store.remove(`memo:passport:${b.data.address.toLowerCase()}:`).catch(() => {});
    return c.json({ ok: true, agentId: r.identity.agentId, identity: r.identity });
  });

  /** Directory of linked agents, best first. */
  app.get("/v1/passport", async (c) => {
    c.header("cache-control", "public, max-age=60");
    return c.json(await memo("passport:directory", 300, async () => {
      const linked = (await store.members("passport:linked")).slice(0, 200);
      const rows = await Promise.all(linked.map(async (a) => {
        const p = await passport(getAddress(a)).catch(() => null);
        return p && { address: p.address, agentId: p.agentId, name: p.identity?.registration?.name ?? null, score: p.score, tier: p.tier };
      }));
      return rows.filter((r): r is NonNullable<typeof r> => !!r).sort((x, y) => (y.score ?? -1) - (x.score ?? -1));
    }));
  });

  /** ERC-8004 feedback files Heimdall published, at a stable URL (feedbackURI onchain points here). */
  app.get("/v1/passport/feedback/:hash", async (c) => {
    const f = await store.fetch(`passport:feedback:${c.req.param("hash").toLowerCase()}`).catch(() => null);
    if (!f) return c.json({ error: "not_found" }, 404);
    c.header("cache-control", "public, max-age=31536000, immutable");
    return c.body(f, 200, { "content-type": "application/json" });
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
    const blocked = await admit(c, PRICE.wallet);
    if (blocked) return blocked;
    const cacheKey = `walletcache:${a.toLowerCase()}`;
    const fresh = c.req.query("refresh") === "1";
    const hit = fresh ? null : await store.fetch(cacheKey).catch(() => null);
    if (hit) return c.json(JSON.parse(hit));
    try {
      const client = getClient(4663);
      const [report, holdings] = await Promise.all([
        scanWallet(a as `0x${string}`, { client, store, deniedTargets: await deniedTargets() }),
        explorerHoldings(a as `0x${string}`),
      ]);
      await rememberFlagged(store, a, report.approvals.filter((r) => r.risk !== "ok"));
      // the tokens it holds can be the trap too: fakes, blocklisted tokens, honeypots and clawbacks
      const tokens = await flagHoldings(client, holdings, { check: (t) => cachedTokenCheck(t) }).catch(() => []);
      Object.assign(report, { tokens, tokensChecked: holdings.length });
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
  /**
   * The caller's IP for rate limits and quotas. Behind Vercel, x-forwarded-for is set by the platform. Heimdall's own
   * hosted MCP server calls in from one IP for many users, so it may name the real caller with x-heimdall-client-ip,
   * but only together with the relay key (SHIELD_RELAY_KEY_SHA256): nobody else can pick the IP they are counted under.
   */
  // one relay key per trusted host: the hosted MCP server (SHIELD_RELAY_KEY_SHA256) and the website (_WEB)
  const relayHashes = [env.SHIELD_RELAY_KEY_SHA256, env.SHIELD_RELAY_KEY_SHA256_WEB]
    .flatMap((v) => (v ?? "").split(",")).map((v) => v.trim()).filter((v) => /^[0-9a-f]{64}$/i.test(v)).map((v) => Buffer.from(v, "hex"));
  const relayOk = (c: any) => {
    const got = c.req.header("x-heimdall-relay");
    if (!relayHashes.length || !got) return false;
    const a = createHash("sha256").update(got).digest();
    return relayHashes.some((b) => timingSafeEqual(a, b));
  };
  function clientIp(c: any, fallback: string): string {
    const relayed = c.req.header("x-heimdall-client-ip");
    if (relayed && /^[0-9a-fA-F:.]{2,45}$/.test(relayed) && relayOk(c)) return relayed;
    return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || fallback;
  }

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
    const ip = clientIp(c, "local");
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
    const ip = clientIp(c, "local");
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
    const body = await memo("status", 30, async () => {
      const s = await status(store, async () => { const b = await getClient(4663).getBlock(); return { block: b.number!, timestamp: b.timestamp, provider: activeProvider(4663) ?? undefined }; });
      const risk = await riskEntries().catch(() => [] as RiskEntry[]);
      return { ...s, version: "0.2.0", mode: prelaunch(env) ? "prelaunch" : "live", protection: { blocklisted: blocklistEntries().length, riskListed: risk.length } };
    });
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
  /** The monitor's status heartbeat. Takes the admin key or the narrow heartbeat key (SHIELD_HEARTBEAT_KEY_SHA256), which opens nothing else. */
  const isHeartbeat = (c: any) => {
    const want = env.SHIELD_HEARTBEAT_KEY_SHA256, got = c.req.header("x-heartbeat-key");
    if (!want || !got) return false;
    const a = createHash("sha256").update(got).digest(), b = Buffer.from(want, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  };
  app.post("/v1/admin/heartbeat", limitBody, async (c) => {
    if (!isAdmin(c) && !isHeartbeat(c)) return c.json({ error: "forbidden" }, 403);
    const b = (await c.req.json().catch(() => ({}))) as { service?: string; probes?: Record<string, boolean>; detail?: string };
    if (b.service !== "monitor" && b.service !== "keeper") return c.json({ error: "invalid_service" }, 400);
    const probes = Object.fromEntries(Object.entries(b.probes ?? {}).filter(([k, v]) => (k === "shield" || k === "rpc") && typeof v === "boolean"));
    await recordHeartbeat(store, b.service, probes, b.detail);
    return c.body(null, 204);
  });
  /** Launch-day checklist (admin/launch on the web): which steps are done, by whom and when. Kept for a year. */
  app.get("/v1/admin/launch", admin(async (c) => c.json(JSON.parse((await store.fetch("launch:checklist")) ?? "{}"))));
  app.put("/v1/admin/launch", limitBody, admin(async (c) => {
    const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || typeof b !== "object" || Array.isArray(b)) return c.json({ error: "invalid_body" }, 400);
    const clean: Record<string, { at: number; note?: string }> = {};
    for (const [id, v] of Object.entries(b).slice(0, 200)) {
      const e = v as { at?: unknown; note?: unknown };
      if (!/^[a-z0-9-]{1,40}$/.test(id) || typeof e?.at !== "number") continue;
      clean[id] = { at: e.at, ...(typeof e.note === "string" && e.note ? { note: e.note.slice(0, 300) } : {}) };
    }
    await store.put("launch:checklist", JSON.stringify(clean), 400 * 86_400);
    return c.json(clean);
  }));
  app.get("/v1/admin/incidents", admin(async (c) => c.json(await listIncidents(store))));
  app.post("/v1/admin/incidents", limitBody, admin(async (c) => {
    const r = await upsertIncident(store, (await c.req.json().catch(() => ({}))) as Record<string, string>);
    if (r.ok) await store.remove("memo:status").catch(() => {});
    return c.json(r, r.ok ? 200 : 400);
  }));
  app.get("/v1/admin/growth", admin(async (c) => c.json(await growthStats(store, Math.min(60, Number(c.req.query("days") ?? 14))))));
  /** Monitor: which linked agents need a new score onchain (changed by 5+ points, or 7 days old). Stores their feedback files. */
  app.post("/v1/admin/passport/due", admin(async (c) => {
    const publisher = env.PASSPORT_PUBLISHER_ADDRESS;
    if (!publisher || !isAddress(publisher)) return c.json({ error: "not_configured", message: "Set PASSPORT_PUBLISHER_ADDRESS" }, 503);
    const linked = (await store.members("passport:linked")).slice(0, 200);
    const due: { address: string; agentId: string; score: number; tier: string; feedbackURI: string; feedbackHash: string }[] = [];
    for (const a of linked) {
      const p = await passport(getAddress(a)).catch(() => null);
      if (!p?.agentId || p.score === null) continue;
      const last = JSON.parse((await store.fetch(`passport:last:${a}`).catch(() => null)) ?? "null") as { score: number; at: number } | null;
      if (last && Math.abs(last.score - p.score) < 5 && Date.now() - last.at < 7 * 86_400_000) continue;
      const file = feedbackFile({ agentId: p.agentId, publisher: getAddress(publisher), chainId: 4663, score: p.score, tier: p.tier, address: p.address, components: p.components });
      const hash = feedbackHash(file);
      await store.put(`passport:feedback:${hash.toLowerCase()}`, JSON.stringify(file));
      due.push({ address: p.address, agentId: p.agentId, score: p.score, tier: p.tier, feedbackURI: `${publicApi}/v1/passport/feedback/${hash}`, feedbackHash: hash });
    }
    return c.json({ due });
  }));

  app.post("/v1/admin/passport/published", admin(async (c) => {
    const b = z.object({ address: addr, score: z.number().int().min(0).max(100), tx: z.string() }).safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json({ error: "invalid_request" }, 400);
    await store.put(`passport:last:${b.data.address.toLowerCase()}`, JSON.stringify({ score: b.data.score, at: Date.now(), tx: b.data.tx }));
    return c.json({ ok: true });
  }));

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

/** Vercel's Hono preset loads this file and needs the app as its default export. Elsewhere (tests, tsx) nothing is built on import. */
export default process.env.VERCEL ? buildApp() : undefined;

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  const port = Number(process.env.PORT ?? 8787);
  (prelaunch() ? Promise.resolve({ kind: "prelaunch", address: "none" }) : getSigner()).then((s) => {
    if (s.kind === "prelaunch") console.log("[shield] pre-launch mode: checks run, no receipts are signed");
    else if (s.kind === "ephemeral") console.warn("[shield] no signer configured — using an EPHEMERAL key (dev only)", s.address);
    else console.log(`[shield] receipt signer (${s.kind})`, s.address);
    serve({ fetch: buildApp().fetch, port });
    console.log(`[shield] listening on :${port}`);
  }).catch((e) => {
    console.error("[shield] refusing to start:", (e as Error).message);
    process.exit(1);
  });
}
