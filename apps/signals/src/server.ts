import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { createPublicClient, fallback, http, isAddress, getAddress, type Address, type PublicClient } from "viem";
import { gateVoucher, MemoryLedger, robinhoodChain, type VoucherLedger } from "@heimdallfund/sdk";
import { addressIntel, poolPrice, referencePrice, tokenRisk, type StockSource } from "./analyzers.js";
import { UpstashLedger } from "./ledger.js";

export interface SignalsConfig {
  chainId: number;
  signals: Address; // HeimdallSignals contract
  usdg: Address;
  ids: { tokenRisk?: bigint; addressIntel?: bigint; stockPremium?: bigint };
  prices: { tokenRisk: bigint; addressIntel: bigint; stockPremium: bigint }; // USDG base units
  stocks: Record<string, StockSource>;
  reference?: { url: string; path: string };
  blocklist: Set<string>;
  free?: boolean; // dev only: skip payment
}

export function configFromEnv(env = process.env): SignalsConfig {
  const id = (v?: string) => (v ? BigInt(v) : undefined);
  return {
    chainId: 4663,
    signals: (env.HEIMDALL_SIGNALS_ADDRESS ?? "0x0000000000000000000000000000000000000000") as Address,
    usdg: (env.USDG_ADDRESS ?? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168") as Address,
    ids: { tokenRisk: id(env.SIGNAL_ID_TOKEN_RISK), addressIntel: id(env.SIGNAL_ID_ADDRESS_INTEL), stockPremium: id(env.SIGNAL_ID_STOCK_PREMIUM) },
    prices: { tokenRisk: BigInt(env.PRICE_TOKEN_RISK ?? 20_000), addressIntel: BigInt(env.PRICE_ADDRESS_INTEL ?? 10_000), stockPremium: BigInt(env.PRICE_STOCK_PREMIUM ?? 50_000) },
    stocks: env.STOCK_POOLS ? JSON.parse(env.STOCK_POOLS) : {},
    reference: env.REFERENCE_PRICE_URL ? { url: env.REFERENCE_PRICE_URL, path: env.REFERENCE_PRICE_PATH ?? "price" } : undefined,
    blocklist: new Set((env.SHIELD_BLOCKLIST ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)),
    free: env.SIGNALS_FREE === "true" && env.NODE_ENV !== "production",
  };
}

export function buildApp(cfg: SignalsConfig, client: PublicClient, ledger: VoucherLedger = new MemoryLedger(), fetchImpl: typeof fetch = fetch) {
  const app = new Hono();
  app.use("*", cors({ origin: "*", allowHeaders: ["content-type", "x-heimdall-voucher"], exposeHeaders: ["x-heimdall-paid"] }));

  const catalog = [
    { slug: "token-risk", id: cfg.ids.tokenRisk, price: cfg.prices.tokenRisk, name: "Token risk score", category: "risk", description: "Contract, proxy, owner powers and blocklist checks for any token on Robinhood Chain.", query: "token=0x…" },
    { slug: "address-intel", id: cfg.ids.addressIntel, price: cfg.prices.addressIntel, name: "Address intel", category: "onchain", description: "EOA, contract or EIP-7702 delegate; activity, balances and blocklist status.", query: "address=0x…" },
    { slug: "stock-premium", id: cfg.ids.stockPremium, price: cfg.prices.stockPremium, name: "Stock token premium vs. exchange", category: "stocks", description: "Onchain stock token price against its exchange reference price, as a premium or discount.", query: "symbol=NVDA" },
  ];

  app.get("/health", (c) => c.json({ ok: true, service: "heimdall-signals" }));
  app.get("/v1/signals", (c) => c.json(catalog.map((s) => ({ ...s, id: s.id?.toString() ?? null, price: s.price.toString(), currency: "USDG", decimals: 6, endpoint: `/v1/${s.slug}?${s.query}` }))));

  /** Charge one call: verify the voucher first, answer, then commit — never charge for a failed answer. */
  async function paid(c: any, signalId: bigint | undefined, price: bigint, work: () => Promise<unknown>) {
    if (cfg.free) return c.json(await work());
    if (signalId === undefined) return c.json({ error: "signal_not_registered" }, 503);
    const gate = await gateVoucher({ chainId: cfg.chainId, signals: cfg.signals, signalId, pricePerCall: price, client, ledger }, c.req.header("x-heimdall-voucher"));
    if (!gate.ok) return c.json(gate.body, gate.status);
    let answer: unknown;
    try { answer = await work(); } catch (e) { return c.json({ error: "signal_failed", message: (e as Error).message }, 502); }
    if (!(await gate.commit())) return c.json({ error: "voucher_conflict", message: "This voucher was already used for another call. Sign a new one." }, 409);
    c.header("x-heimdall-paid", price.toString());
    return c.json(answer);
  }

  app.get("/v1/token-risk", async (c) => {
    const token = c.req.query("token");
    if (!token || !isAddress(token)) return c.json({ error: "invalid_request", message: "token=0x… required" }, 400);
    return paid(c, cfg.ids.tokenRisk, cfg.prices.tokenRisk, () => tokenRisk(client, getAddress(token), cfg.blocklist));
  });

  app.get("/v1/address-intel", async (c) => {
    const a = c.req.query("address");
    if (!a || !isAddress(a)) return c.json({ error: "invalid_request", message: "address=0x… required" }, 400);
    return paid(c, cfg.ids.addressIntel, cfg.prices.addressIntel, () => addressIntel(client, getAddress(a), cfg.usdg, cfg.blocklist));
  });

  app.get("/v1/stock-premium", async (c) => {
    const symbol = (c.req.query("symbol") ?? "").toUpperCase();
    const src = cfg.stocks[symbol];
    if (!src) return c.json({ error: "unknown_symbol", supported: Object.keys(cfg.stocks) }, 404);
    if (!cfg.reference) return c.json({ error: "not_configured", message: "No exchange reference price source configured." }, 503);
    return paid(c, cfg.ids.stockPremium, cfg.prices.stockPremium, async () => {
      const [onchain, reference] = await Promise.all([poolPrice(client, src), referencePrice(cfg.reference!.url, cfg.reference!.path, symbol, fetchImpl)]);
      const premiumBps = Math.round((onchain / reference - 1) * 10_000);
      return { symbol, onchain, reference, premiumBps, premiumPct: premiumBps / 100, at: new Date().toISOString() };
    });
  });

  return app;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  const cfg = configFromEnv();
  const transports = [...(process.env.RPC_URL_MAINNET ? [http(process.env.RPC_URL_MAINNET)] : []), http()];
  const client = createPublicClient({ chain: robinhoodChain, transport: fallback(transports) }) as PublicClient;
  const port = Number(process.env.PORT ?? 8788);
  const env = process.env;
  const ledger = env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN ? new UpstashLedger(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN) : new MemoryLedger();
  if (env.NODE_ENV === "production" && ledger instanceof MemoryLedger) throw new Error("Set UPSTASH_REDIS_REST_URL/TOKEN in production: accepted vouchers must survive restarts.");
  serve({ fetch: buildApp(cfg, client, ledger).fetch, port });
  console.log(`[signals] listening on :${port}${cfg.free ? " (FREE dev mode)" : ""}`);
}
