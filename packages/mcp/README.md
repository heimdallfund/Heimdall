# @heimdallfund/mcp

One config line gives any agent that speaks the Model Context Protocol a firewall: it checks every transaction and every signature request before it signs.

## Add it to your agent

### Claude Desktop

File: `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "heimdall": {
      "command": "npx",
      "args": ["-y", "@heimdallfund/mcp"],
      "env": { "HEIMDALL_API_KEY": "hd_live_…" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add heimdall -e HEIMDALL_API_KEY=hd_live_… -- npx -y @heimdallfund/mcp
```

### Cursor

File: `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "heimdall": {
      "command": "npx",
      "args": ["-y", "@heimdallfund/mcp"],
      "env": { "HEIMDALL_API_KEY": "hd_live_…" }
    }
  }
}
```

### VS Code

File: `.vscode/mcp.json`

```json
{
  "servers": {
    "heimdall": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@heimdallfund/mcp"],
      "env": { "HEIMDALL_API_KEY": "hd_live_…" }
    }
  }
}
```

### Remote (HTTP)

```bash
# Run your own remote MCP endpoint (Streamable HTTP, stateless)
HEIMDALL_API_KEY=hd_live_… npx -y @heimdallfund/mcp --http 3333
# → point any MCP client at http://your-host:3333/mcp
```

### Vercel AI SDK

```typescript
import { experimental_createMCPClient as createMCPClient, generateText } from "ai";
import { Experimental_StdioMCPTransport as Stdio } from "ai/mcp-stdio";

const heimdall = await createMCPClient({
  transport: new Stdio({ command: "npx", args: ["-y", "@heimdallfund/mcp"], env: { HEIMDALL_API_KEY: process.env.HEIMDALL_API_KEY! } }),
});
const { text } = await generateText({
  model,
  tools: await heimdall.tools(),
  system: "Call heimdall_check_transaction before sending any transaction. Never sign on DENY.",
  prompt: "Approve 100 USDG to 0xcaf6…5cb2 and tell me if it is safe.",
});
```

### LangChain

```typescript
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const mcp = new MultiServerMCPClient({
  heimdall: { transport: "stdio", command: "npx", args: ["-y", "@heimdallfund/mcp"], env: { HEIMDALL_API_KEY: process.env.HEIMDALL_API_KEY! } },
});
const tools = await mcp.getTools(); // pass to createReactAgent({ llm, tools })
```

### ElizaOS

File: `character.json`

```json
{
  "plugins": ["@elizaos/plugin-mcp"],
  "settings": {
    "mcp": {
      "servers": {
        "heimdall": { "type": "stdio", "command": "npx", "args": ["-y", "@heimdallfund/mcp"] }
      }
    }
  }
}
```

The server ships instructions that tell the model to check before every send and every signature, never to sign on DENY, and to treat a failed check as DENY.

## Tools

| Tool | What it does |
| --- | --- |
| `heimdall_check_transaction` | Simulates a transaction before signing: ALLOW, WARN or DENY with reasons. Optional share link. |
| `heimdall_check_signature` | Judges EIP-712 typed data (Permit, Permit2, orders) or personal_sign before signing, and lists who gets spending rights. |
| `heimdall_check_address` | Vets a spender or recipient: blocklist, recent denials, wallet or contract, simulated unlimited approval. |
| `heimdall_wallet_check` | Lists every live approval of a wallet, ranked danger / review / ok, with the dollars each exposes. |
| `heimdall_check_tx_hash` | Looks up a pending or mined transaction by hash and judges it. |
| `heimdall_threats` | The Threat Board: top patterns, most-denied addresses and recent denials (7 days). |
| `heimdall_agent_reputation` | Public Shield history of an agent wallet: checks, allowed, warned, denied. |
| `heimdall_get_verdict` | Opens a shared verdict by id. |
| `heimdall_vault_info` | NAV, share price, manager, loss limits and worst case per 1,000 USDG of a vault. |
| `heimdall_list_vaults` | Vaults created through the factory. |
| `heimdall_pay_jobs` | Heimdall Pay jobs of an agent as client or provider, plus its record: completed, disputed, earned. |
| `heimdall_pay_job` | One escrow job: amount, parties, arbiter, deadline, review window and hashes. Check it before starting paid work. |
| `heimdall_arena` | Agent Arena standings: vaults ranked by season return, with drawdown, TVL and depositors. |
| `heimdall_list_signals` | Pay-per-call signals with price per call. |

## Prompt

`safe_send` walks the model through building a transaction, checking the approval and the transaction, and explaining the verdict before anything is signed.

## Environment

| Variable | Meaning |
| --- | --- |
| `HEIMDALL_API_KEY` | Shield API key. Optional: without one you get the free tier. |
| `HEIMDALL_API_URL` | Defaults to the public Shield API. |
| `HEIMDALL_WEB_URL` | Base for share links and profiles. |
| `HEIMDALL_CHAIN` | `mainnet` (default) or `testnet`. |
| `RPC_URL` | Robinhood Chain RPC for reads. |
| `HEIMDALL_SIGNALS_ADDRESS` / `HEIMDALL_FACTORY_ADDRESS` | Contract addresses for the signal and vault tools. |

## Develop

```bash
npm run build && npm test
```
