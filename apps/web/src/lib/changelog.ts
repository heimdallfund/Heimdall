/** What changed, newest first. Dates in UTC. One entry per day, grouped by area; written for users, not as a commit log. */
export type ChangeTag = "Shield" | "Integrations" | "Agents" | "Security" | "Web" | "Contracts" | "Docs";
export interface ChangeEntry { date: string; title: string; summary: string; changes: { tag: ChangeTag; text: string }[] }

export const CHANGELOG: ChangeEntry[] = [
  {
    date: "2026-11-24",
    title: "Agents can find and use Heimdall on their own",
    summary: "A hosted MCP server, an OpenAPI spec and discovery files mean an agent or a developer tool can connect without anyone setting it up. Plus a live status page, a bigger sourced blocklist and a security pass on the Shield API.",
    changes: [
      { tag: "Shield", text: "Uniswap v4 hooks: a swap through a pool whose hook can change the amounts, set the fee at swap time, or does not exist is flagged before you sign." },
      { tag: "Web", text: "Token Check: paste any Robinhood Chain token and see a simulated buy, sell and transfer through its Uniswap v3 or v4 pool, the taxes, whether it can be clawed back from your wallet, and whether it fakes a real ticker. Also in the API, both SDKs and the MCP server." },
      { tag: "Shield", text: "EIP-7702 delegations, the newest drainer trick: signing one hands a contract full control of the wallet. Shield allows only known wallet implementations and denies any other, plus authorizations valid on every chain." },
      { tag: "Shield", text: "Catches the three scams Robinhood Chain is known for: honeypots that cannot be sold back to their pool, tokens that vanish or can be pulled out of your wallet after you buy, and fake tokens with a real ticker such as USDG or NVDA." },
      { tag: "Shield", text: "Address poisoning: a recipient that starts and ends like an address you already use, but is not it, is denied." },
      { tag: "Docs", text: "Three new guides: address poisoning, fake tokens with a real ticker, and tokens that vanish or cannot be sold after you buy them." },
      { tag: "Docs", text: "llms-full.txt holds every docs page in one file, and each docs page has a Markdown twin: add .md to its URL." },
      { tag: "Docs", text: "Python SDK: pip install heimdallfund, with check, guard, signature checks and lookups, sync and async." },
      { tag: "Agents", text: "Agent2Agent (A2A v1.0): other agents can hand Heimdall a check as a task; the agent card is at /.well-known/agent-card.json." },
      { tag: "Agents", text: "Remote MCP server at mcp.heimdall.fund/mcp over Streamable HTTP, with a server card for discovery. Each caller keeps their own free tier." },
      { tag: "Agents", text: "llms.txt at heimdall.fund/llms.txt: what Heimdall is and where every piece lives, for language models." },
      { tag: "Docs", text: "OpenAPI 3.1 spec at /openapi.json, generated from the same schemas the API validates with, and an API reference with a live Try it for every endpoint." },
      { tag: "Web", text: "Status page refreshes itself every 15 seconds: head block, Shield and RPC response times, checks per day by verdict, uptime and incidents." },
      { tag: "Security", text: "Blocklist grows to 12 addresses: a memecoin rug-factory collector flagged by GoPlus and the Step Drainer behind the Name.com DNS hijack. Every entry links its public source and was checked onchain." },
      { tag: "Web", text: "Threat Board shows why each address is blocked, where the report came from and when it was added." },
      { tag: "Security", text: "Shield API load and abuse test: about 10,000 requests a second with no errors. Fixed: server-side request forgery through agent registration files and webhooks, values above uint256, no global body limit." },
      { tag: "Shield", text: "Paid RPC first, the public endpoint as fallback. The monitor reports to the status page with a key that can do nothing else." },
      { tag: "Contracts", text: "Business Source License 1.1; interfaces and integration helpers stay MIT." },
    ],
  },
  {
    date: "2026-11-23",
    title: "Integrations: Risk Oracle, Guard for Safe, x402 and Agent Passport",
    summary: "Four ways for other protocols to use Heimdall without calling our API: read risk onchain, guard a Safe, pay per check, and give an agent a reputation.",
    changes: [
      { tag: "Integrations", text: "Risk Oracle: any contract can read an address's risk level onchain before it trusts it." },
      { tag: "Integrations", text: "Guard for Safe: a module that lets an agent spend from a Safe only with a Shield ALLOW receipt and within daily limits the owners set." },
      { tag: "Integrations", text: "x402: pay per Shield check in USDG on Robinhood Chain, no account or key; Heimdall runs its own facilitator." },
      { tag: "Integrations", text: "Agent Passport on the official ERC-8004 registries: a public score built from what Shield sees an agent do." },
      { tag: "Contracts", text: "Third security review: invariant tests, fee-aware ERC-4626 views, every contract under the size limit. A full mainnet-fork rehearsal runs real money through every product, 32 of 32 steps." },
      { tag: "Security", text: "No bug bounty: an independent audit comes before launch. Reports go to security@heimdall.fund." },
      { tag: "Web", text: "Logos for every chain, token, stock and tool the site mentions; faster pages and new share images." },
      { tag: "Shield", text: "Pre-launch mode: checks run on mainnet today, signed receipts start at launch." },
    ],
  },
];
