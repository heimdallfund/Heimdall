/** Copy-paste setup for each agent client. Shared by /docs/mcp and the Shield page. */
export const MCP_CLIENTS: { id: string; label: string; lang: string; file?: string; code: string }[] = [
  {
    id: "claude-desktop", label: "Claude Desktop", lang: "json", file: "claude_desktop_config.json",
    code: `{
  "mcpServers": {
    "heimdall": {
      "command": "npx",
      "args": ["-y", "@heimdall/mcp"],
      "env": { "HEIMDALL_API_KEY": "hd_live_…" }
    }
  }
}`,
  },
  {
    id: "claude-code", label: "Claude Code", lang: "bash",
    code: `claude mcp add heimdall -e HEIMDALL_API_KEY=hd_live_… -- npx -y @heimdall/mcp`,
  },
  {
    id: "cursor", label: "Cursor", lang: "json", file: ".cursor/mcp.json",
    code: `{
  "mcpServers": {
    "heimdall": {
      "command": "npx",
      "args": ["-y", "@heimdall/mcp"],
      "env": { "HEIMDALL_API_KEY": "hd_live_…" }
    }
  }
}`,
  },
  {
    id: "vscode", label: "VS Code", lang: "json", file: ".vscode/mcp.json",
    code: `{
  "servers": {
    "heimdall": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@heimdall/mcp"],
      "env": { "HEIMDALL_API_KEY": "hd_live_…" }
    }
  }
}`,
  },
  {
    id: "remote", label: "Remote (HTTP)", lang: "bash",
    code: `# Run your own remote MCP endpoint (Streamable HTTP, stateless)
HEIMDALL_API_KEY=hd_live_… npx -y @heimdall/mcp --http 3333
# → point any MCP client at http://your-host:3333/mcp`,
  },
  {
    id: "ai-sdk", label: "Vercel AI SDK", lang: "ts",
    code: `import { experimental_createMCPClient as createMCPClient, generateText } from "ai";
import { Experimental_StdioMCPTransport as Stdio } from "ai/mcp-stdio";

const heimdall = await createMCPClient({
  transport: new Stdio({ command: "npx", args: ["-y", "@heimdall/mcp"], env: { HEIMDALL_API_KEY: process.env.HEIMDALL_API_KEY! } }),
});
const { text } = await generateText({
  model,
  tools: await heimdall.tools(),
  system: "Call heimdall_check_transaction before sending any transaction. Never sign on DENY.",
  prompt: "Approve 100 USDG to 0xcaf6…5cb2 and tell me if it is safe.",
});`,
  },
  {
    id: "langchain", label: "LangChain", lang: "ts",
    code: `import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const mcp = new MultiServerMCPClient({
  heimdall: { transport: "stdio", command: "npx", args: ["-y", "@heimdall/mcp"], env: { HEIMDALL_API_KEY: process.env.HEIMDALL_API_KEY! } },
});
const tools = await mcp.getTools(); // pass to createReactAgent({ llm, tools })`,
  },
  {
    id: "eliza", label: "ElizaOS", lang: "json", file: "character.json",
    code: `{
  "plugins": ["@elizaos/plugin-mcp"],
  "settings": {
    "mcp": {
      "servers": {
        "heimdall": { "type": "stdio", "command": "npx", "args": ["-y", "@heimdall/mcp"] }
      }
    }
  }
}`,
  },
];

export const MCP_TOOLS: [string, string][] = [
  ["heimdall_check_transaction", "Simulates a transaction before signing: ALLOW, WARN or DENY with reasons. Optional share link."],
  ["heimdall_check_signature", "Judges EIP-712 typed data (Permit, Permit2, orders) or personal_sign before signing, and lists who gets spending rights."],
  ["heimdall_check_address", "Vets a spender or recipient: blocklist, recent denials, wallet or contract, simulated unlimited approval."],
  ["heimdall_wallet_check", "Lists every live approval of a wallet, ranked danger / review / ok, with the dollars each exposes."],
  ["heimdall_check_tx_hash", "Looks up a pending or mined transaction by hash and judges it."],
  ["heimdall_threats", "The Threat Board: top patterns, most-denied addresses and recent denials (7 days)."],
  ["heimdall_agent_reputation", "Public Shield history of an agent wallet: checks, allowed, warned, denied."],
  ["heimdall_passport", "Agent Passport: Heimdall Score (0-100), tier, ERC-8004 identity and onchain reputation."],
  ["heimdall_risk", "Risk level of an address (none, low, warn, blocked) with reasons, and the onchain Risk Oracle entry."],
  ["heimdall_get_verdict", "Opens a shared verdict by id."],
  ["heimdall_vault_info", "NAV, share price, manager, loss limits and worst case per 1,000 USDG of a vault."],
  ["heimdall_list_vaults", "Vaults created through the factory."],
  ["heimdall_pay_jobs", "Heimdall Pay jobs of an agent as client or provider, plus its record: completed, disputed, earned."],
  ["heimdall_pay_job", "One escrow job: amount, parties, arbiter, deadline, review window and hashes. Check it before starting paid work."],
  ["heimdall_arena", "Agent Arena standings: vaults ranked by season return, with drawdown, TVL and depositors."],
  ["heimdall_list_signals", "Pay-per-call signals with price per call."],
];
