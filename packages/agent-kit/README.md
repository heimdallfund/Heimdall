# @heimdall/agent-kit

Heimdall Shield and Heimdall Pay as native tools for the **Vercel AI SDK**, **LangChain** and **ElizaOS**. Every framework gets the same tool names, inputs and answers.

```bash
npm i @heimdall/agent-kit
```

## Vercel AI SDK

```ts
import { generateText } from "ai";
import { heimdallAiTools } from "@heimdall/agent-kit/ai-sdk";

const { text } = await generateText({ model, tools: heimdallAiTools({ wallet }), prompt: "Swap 50 USDG for NVDA" });
```

`heimdall_safe_send` pauses for human approval by default (`approveSends: false` turns that off).

## LangChain / LangGraph

```ts
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { heimdallLangChainTools } from "@heimdall/agent-kit/langchain";

const agent = createReactAgent({ llm, tools: heimdallLangChainTools({ wallet }) });
```

## ElizaOS

```ts
import { heimdallPlugin } from "@heimdall/agent-kit/eliza";

export const character = { name: "Trader", plugins: [heimdallPlugin()] };
```

The plugin reads `HEIMDALL_API_URL`, `HEIMDALL_API_KEY` and `HEIMDALL_PAY_ADDRESS` from the character or the environment. Each tool becomes an action with typed parameters (`HEIMDALL_CHECK_TRANSACTION`, …).

## Tools

| Tool | What it does |
| --- | --- |
| `heimdall_check_transaction` | Simulate a transaction: ALLOW, WARN or DENY, with reasons and token moves |
| `heimdall_check_signature` | Judge EIP-712 / personal_sign requests: Permit, Permit2, Seaport, hidden approvals |
| `heimdall_wallet_check` | Risky approvals a wallet has given, with the USD each spender could take |
| `heimdall_agent_reputation` | How another agent has behaved under Shield |
| `heimdall_threats` | Known drainers, most-denied contracts, community blocklist |
| `heimdall_pay_job` | Read a Heimdall Pay escrow job (needs `publicClient` + `payAddress`) |
| `heimdall_pay_record` | A provider's jobs completed, disputed and USDG earned |
| `heimdall_safe_send` | Send from the agent's wallet only when Shield allows it (needs `wallet`) |

## Options

| Option | Meaning |
| --- | --- |
| `apiKey`, `baseUrl` | Shield API key and URL. No key = free tier |
| `policy` | Applied to every check |
| `wallet` | viem wallet; adds `heimdall_safe_send` |
| `allowWarn` | Let `heimdall_safe_send` go ahead on WARN (default off) |
| `approveSends` | AI SDK: ask a human before `heimdall_safe_send` (default on) |
| `publicClient`, `payAddress` | Turn on the Pay tools |
| `only` | Pick tools by name |

Framework-neutral definitions are exported too: `heimdallTools(opts)` returns `{ name, description, schema, run }` for any other framework.
