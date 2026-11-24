import type { TokenCheck } from "./tokencheck.js";

/**
 * A plain-language summary of a Token Check, written by a model from the check's own results and nothing else.
 * The verdict always comes from the simulation; the model only explains it. Runs through Vercel AI Gateway with the
 * deployment's OIDC token (or AI_GATEWAY_API_KEY). Returns null when no model is reachable: the report stands alone.
 */
export const AI_MODEL = process.env.AI_GATEWAY_MODEL ?? "anthropic/claude-haiku-5.5";

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
  const token = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN ?? opts.oidc;
  if (!token) return null;
  const res = await (opts.fetcher ?? fetch)("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 220,
      temperature: 0,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: JSON.stringify(facts(r)) }],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
  });
  if (!res.ok) return null;
  const j = await res.json() as { choices?: { message?: { content?: string } }[] };
  const text = j.choices?.[0]?.message?.content?.trim();
  return text ? text.slice(0, 900) : null;
}
