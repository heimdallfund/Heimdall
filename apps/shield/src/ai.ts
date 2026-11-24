import type { TokenCheck } from "./tokencheck.js";

/**
 * A plain-language summary of a Token Check, written by a model from the check's own results and nothing else.
 * The verdict always comes from the simulation; the model only explains it. Runs through Vercel AI Gateway with the
 * deployment's OIDC token (or AI_GATEWAY_API_KEY). Returns null when no model is reachable: the report stands alone.
 */
/** Tried in order: the first the gateway serves this team is used (free-tier teams cannot use every model). */
export const AI_MODELS = (process.env.AI_GATEWAY_MODEL ?? "anthropic/claude-haiku-5.5,anthropic/claude-haiku-4.5,google/gemini-2.5-flash,deepseek/deepseek-v4-flash").split(",").map((m) => m.trim()).filter(Boolean);
export const AI_MODEL = AI_MODELS[0]!;

const SYSTEM = `You explain Heimdall Token Check results to crypto traders on Robinhood Chain.
Use ONLY the facts in the JSON you are given. Never add facts, prices, predictions, opinions on the project, or advice to buy or sell.
Heimdall's verdict (ALLOW, WARN or DENY) is final: explain it, never contradict or soften it.
Write in plain English for a non-technical trader: at most 3 short sentences, then one line starting with "Bottom line:".
Name the concrete reasons (honeypot, taxes, clawback, fake ticker, who holds the supply, what the dev did) with the numbers given.
If nothing is wrong, say what was tested and that it passed, and remind that memecoins can still lose value.
No markdown, no emojis, no addresses unless essential.`;

/** The facts the model sees: findings and measured numbers, no free text from the token itself. */
function facts(r: TokenCheck) {
  return {
    verdict: r.verdict, riskScore: r.riskScore, symbol: r.symbol,
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

export async function summarize(r: TokenCheck, opts: { oidc?: string; fetcher?: typeof fetch; timeoutMs?: number } = {}): Promise<{ text: string; model: string } | null> {
  const token = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN ?? opts.oidc;
  if (!token) { console.warn(JSON.stringify({ level: "warn", path: "ai", message: "no AI Gateway credential (AI_GATEWAY_API_KEY or OIDC)" })); return null; }
  const content = JSON.stringify(facts(r));
  for (const model of AI_MODELS) {
    const res = await (opts.fetcher ?? fetch)("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1500, reasoning_effort: "low", temperature: 0, messages: [{ role: "system", content: SYSTEM }, { role: "user", content }] }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
    }).catch(() => null);
    if (!res) continue;
    if (!res.ok) {
      console.warn(JSON.stringify({ level: "warn", path: "ai", message: `gateway ${res.status} for ${model}: ${(await res.text().catch(() => "")).slice(0, 160)}` }));
      if (res.status === 401) return null; // bad credential: no model will work
      continue;
    }
    const j = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content?.trim();
    if (text) return { text: text.slice(0, 900), model };
  }
  return null;
}
