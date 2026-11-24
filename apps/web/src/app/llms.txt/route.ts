import { DOCS } from "@/lib/nav";
import { GUIDE_INDEX } from "@/lib/guideIndex";
import { PUBLIC_API_URL } from "@/lib/config";

/** /llms.txt (llmstxt.org): what Heimdall is and where an agent finds each piece, in Markdown. */
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://heimdall.fund").replace(/\/$/, "");

const body = () => `# Heimdall

> The guardian layer for AI agents on Robinhood Chain (chain ID 4663). Heimdall Shield simulates a transaction or a signature before it is signed and answers ALLOW, WARN or DENY with the reasons. Around it: a Risk Oracle other contracts can read onchain, a Guard module for Safe wallets, pay-per-call x402 payments in USDG, and ERC-8004 agent passports.

Free to start: no key for the free tier. Above it, pay per call with x402 (USDG) or use an API key. Rule for agents: check before ANY transaction or signature; never sign on DENY; on WARN, ask the user; if the check fails, treat it as DENY.

## Connect

- [MCP server (remote)](https://mcp.heimdall.fund/mcp): Streamable HTTP. Claude Code: \`claude mcp add --transport http heimdall https://mcp.heimdall.fund/mcp\`. Server card: https://mcp.heimdall.fund/mcp/server-card
- [MCP server (local)](${SITE}/docs/mcp): \`npx -y @heimdallfund/mcp\` (stdio), for Claude Desktop, Cursor and any MCP client
- [A2A agent](${PUBLIC_API_URL}/.well-known/agent-card.json): Agent2Agent v1.0 over JSON-RPC at ${PUBLIC_API_URL}/a2a. Skills: check-transaction, check-signature, check-address
- [REST API, OpenAPI 3.1](${PUBLIC_API_URL}/openapi.json): every public endpoint; base URL ${PUBLIC_API_URL}
- [API reference](${SITE}/docs/api): the same spec, readable, with a live Try it
- [SDKs](${SITE}/docs/sdk): TypeScript \`npm i @heimdallfund/sdk\`, Python \`pip install heimdallfund\`
- [Agent frameworks](${SITE}/docs/frameworks): ElizaOS, LangChain, Vercel AI SDK, agent-kit
- [x402 payments](${SITE}/docs/x402): pay per check in USDG on Robinhood Chain, no account; discovery at ${PUBLIC_API_URL}/x402/discovery/resources

## Docs

${DOCS.map((s) => s.items.map((i) => `- [${s.title}: ${i.title}](${SITE}${i.href})`).join("\n")).join("\n")}

## Live data

- [Threat Board](${SITE}/threats): what Shield is blocking, and the sourced blocklist (JSON: ${PUBLIC_API_URL}/v1/threats)
- [Risk Oracle list](${PUBLIC_API_URL}/v1/risk): every flagged address with its level
- [Status](${SITE}/status): live service status (JSON: ${PUBLIC_API_URL}/v1/status)

## Guides

${GUIDE_INDEX.map((g) => `- [${g.title}](${SITE}/guides/${g.slug})`).join("\n")}

## Optional

- [Security](${SITE}/security): reviews, invariants, how to report a vulnerability
- [Source code](https://github.com/heimdallfund/Heimdall): BUSL 1.1
- [Changelog](${SITE}/changelog)
`;

export function GET() {
  return new Response(body(), { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
