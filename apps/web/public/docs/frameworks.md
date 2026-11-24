---
description: Heimdall tools for the Vercel AI SDK, LangChain and ElizaOS, with no MCP server to run.
---

# Agent frameworks

`@heimdallfund/agent-kit` gives agents built on the **Vercel AI SDK**, **LangChain** or **ElizaOS** native Heimdall tools. There is no MCP server to run, and every framework gets the same tool names, inputs and answers.

```bash
npm i @heimdallfund/agent-kit
```

## Vercel AI SDK

```ts
import { generateText } from "ai";
import { heimdallAiTools } from "@heimdallfund/agent-kit/ai-sdk";

const { text } = await generateText({ model, tools: heimdallAiTools({ wallet }), prompt: "Swap 50 USDG for NVDA" });
```

`heimdall_safe_send` pauses for human approval by default. Pass `approveSends: false` to let the agent send on its own whenever Shield answers ALLOW.

## LangChain and LangGraph

```ts
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { heimdallLangChainTools } from "@heimdallfund/agent-kit/langchain";

const agent = createReactAgent({ llm, tools: heimdallLangChainTools({ wallet }) });
```

## ElizaOS

```ts
import { heimdallPlugin } from "@heimdallfund/agent-kit/eliza";

export const character = { name: "Trader", plugins: [heimdallPlugin()] };
```

The plugin reads `HEIMDALL_API_URL`, `HEIMDALL_API_KEY` and `HEIMDALL_PAY_ADDRESS` from the character or the environment. Each tool becomes an action with typed parameters, such as `HEIMDALL_CHECK_TRANSACTION`.

## Tools

| Tool | What it does |
| --- | --- |
| `heimdall_check_transaction` | Simulate a transaction: ALLOW, WARN or DENY, with reasons and token moves |
| `heimdall_check_signature` | Judge EIP-712 and personal_sign requests: Permit, Permit2, Seaport, hidden approvals |
| `heimdall_wallet_check` | Risky approvals a wallet has given, with the USD each spender could take |
| `heimdall_agent_reputation` | How another agent has behaved under Shield |
| `heimdall_passport` | Heimdall Score, tier and ERC-8004 identity of another agent |
| `heimdall_risk` | Risk level of any address, from Heimdall's list and the onchain oracle |
| `heimdall_threats` | Known drainers, most-denied contracts and the community blocklist |
| `heimdall_pay_job` | Read a Heimdall Pay escrow job |
| `heimdall_pay_record` | A provider's jobs completed, disputed and USDG earned |
| `heimdall_safe_send` | Send from the agent's wallet only when Shield allows it |

Answers are kept short for the model: the verdict, the reasons that matter, what each token does, and one line of advice. A DENY always says not to sign.

## Options

| Option | Meaning |
| --- | --- |
| `apiKey`, `baseUrl` | Shield API key and URL. Without a key you get the free tier |
| `policy` | Policy applied to every check |
| `wallet` | The agent's viem wallet. Adds `heimdall_safe_send` |
| `allowWarn` | Let `heimdall_safe_send` go ahead on WARN. Off by default |
| `approveSends` | AI SDK only: ask a human before `heimdall_safe_send`. On by default |
| `publicClient`, `payAddress` | Turn on the Pay tools |
| `only` | Pick tools by name |
