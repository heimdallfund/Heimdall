import type { TokenCheck } from "./tokencheck.js";
import { knownToken } from "./registry.js";

/**
 * A plain-language summary of a Token Check, written by a model from the check's own results and nothing else.
 * The verdict always comes from the simulation; the model only explains it. Runs through OpenRouter when
 * OPENROUTER_API_KEY is set, then through Vercel AI Gateway (OIDC or AI_GATEWAY_API_KEY) as a fallback.
 * Returns null when no model is reachable: the report stands alone.
 */
/** OpenRouter models, tried in order. */
export const OPENROUTER_MODELS = (process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-5.5,google/gemini-3.5-flash-lite").split(",").map((m) => m.trim()).filter(Boolean);
/** AI Gateway models, tried in order: the first the gateway serves this team is used (free-tier teams cannot use every model). */
export const AI_MODELS = (process.env.AI_GATEWAY_MODEL ?? "anthropic/claude-haiku-5.5,anthropic/claude-haiku-4.5,google/gemini-2.5-flash,deepseek/deepseek-v4-flash").split(",").map((m) => m.trim()).filter(Boolean);
export const AI_MODEL = process.env.OPENROUTER_API_KEY ? OPENROUTER_MODELS[0]! : AI_MODELS[0]!;

const SYSTEM = `You explain Heimdall Token Check results to crypto traders on Robinhood Chain.
Use ONLY the facts in the JSON you are given. Never add facts, prices, predictions, opinions on the project, or advice to buy or sell.
Heimdall's verdict (ALLOW, WARN or DENY) is final: explain it, never contradict or soften it.
Write in plain English for a non-technical trader: at most 3 short sentences, then one line starting with "Bottom line:".
Always say whether buying and selling worked in the simulation (and where: bonding curve or Uniswap pool) and any tax.
Name the concrete reasons (honeypot, taxes, clawback, fake ticker, who holds the supply, what the dev did) with the numbers given.
The "kind" field says what the token is. Match the closing line to it:
- "stock token": a tokenized stock tracking the real share price; say it is the official token and that its price follows the stock, which can go down. Never call it a memecoin.
- "stablecoin": say it is the official stablecoin; no price-risk reminder.
- "wrapped ETH": say it is the official wrapped ETH; its price follows ETH.
- "launchpad memecoin" or "memecoin": if nothing is wrong, say what passed and that memecoins are highly volatile and can go to zero.
- "token": if nothing is wrong, say what passed and that a clean check does not mean the price cannot fall.
No markdown, no emojis, no addresses unless essential.`;

/** The facts the model sees: findings and measured numbers, no free text from the token itself. */
function facts(r: TokenCheck) {
  const known = knownToken(r.token);
  const kind = known ? (known.stable ? "stablecoin" : known.symbol === "WETH" ? "wrapped ETH" : "stock token")
    : r.launch ? "launchpad memecoin" : r.holders ? "memecoin" : "token";
  return {
    kind, verdict: r.verdict, riskScore: r.riskScore, symbol: r.symbol,
    launchpad: r.launch && { name: r.launch.launchpad, onBondingCurve: r.launch.graduated === false, progressPct: r.launch.progressPct, hasDev: !!r.launch.dev },
    market: r.pool ? `Uniswap v${r.pool.version}` : r.launch?.model === "curve" ? "launchpad bonding curve" : "none found",
    buy: r.buy, sell: r.sell, transfer: r.transfer, clawback: r.pullableBy,
    holders: r.holders && { wallets: r.holders.count, top10Pct: r.holders.top10Pct, biggestPct: r.holders.top[0]?.pct ?? null, devPct: r.holders.devPct, devSoldPct: r.holders.devSoldPct, launchBuyers: r.holders.launchBuyers, devOtherLaunches: r.holders.devLaunches },
    findings: r.findings.map((f) => ({ code: f.code, severity: f.severity, message: f.message.replace(/0x[0-9a-fA-F]{40}/g, "a wallet") })),
  };
}

export async function summarizeTokenCheck(r: TokenCheck, opts: { oidc?: string; fetcher?: typeof fetch; timeoutMs?: number } = {}): Promise<string | null> {
  return (await summarize(r, opts))?.text ?? null;
}

interface Route { name: string; url: string; token: string; models: string[]; extra: Record<string, unknown>; headers: Record<string, string> }

function routes(oidc?: string): Route[] {
  const out: Route[] = [];
  const or = process.env.OPENROUTER_API_KEY;
  if (or) out.push({
    name: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", token: or, models: OPENROUTER_MODELS,
    extra: {}, headers: { "HTTP-Referer": "https://heimdall.fund", "X-Title": "Heimdall Token Check" },
  });
  const gw = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN ?? oidc;
  if (gw) out.push({ name: "gateway", url: "https://ai-gateway.vercel.sh/v1/chat/completions", token: gw, models: AI_MODELS, extra: { reasoning_effort: "low" }, headers: {} });
  return out;
}

export async function summarize(r: TokenCheck, opts: { oidc?: string; fetcher?: typeof fetch; timeoutMs?: number } = {}): Promise<{ text: string; model: string } | null> {
  const list = routes(opts.oidc);
  if (!list.length) { console.warn(JSON.stringify({ level: "warn", path: "ai", message: "no AI credential (OPENROUTER_API_KEY, AI_GATEWAY_API_KEY or OIDC)" })); return null; }
  const content = JSON.stringify(facts(r));
  for (const route of list) {
    for (const model of route.models) {
      const res = await (opts.fetcher ?? fetch)(route.url, {
        method: "POST",
        headers: { authorization: `Bearer ${route.token}`, "content-type": "application/json", ...route.headers },
        body: JSON.stringify({ model, max_tokens: 1500, temperature: 0, ...route.extra, messages: [{ role: "system", content: SYSTEM }, { role: "user", content }] }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
      }).catch(() => null);
      if (!res) continue;
      if (!res.ok) {
        console.warn(JSON.stringify({ level: "warn", path: "ai", message: `${route.name} ${res.status} for ${model}: ${(await res.text().catch(() => "")).slice(0, 160)}` }));
        if (res.status === 401) break; // bad credential: no model on this route will work
        continue;
      }
      const j = await res.json() as { choices?: { message?: { content?: string } }[] };
      const text = j.choices?.[0]?.message?.content?.trim();
      if (text) return { text: text.slice(0, 900), model: route.name === "openrouter" ? `openrouter:${model}` : model };
    }
  }
  return null;
}
