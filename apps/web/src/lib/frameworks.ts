/** Snippets for @heimdallfund/agent-kit, shared by /shield and /docs/frameworks. */
export const FRAMEWORKS: { id: string; label: string; lang: string; code: string }[] = [
  {
    id: "ai-sdk", label: "Vercel AI SDK", lang: "ts",
    code: `import { generateText } from "ai";
import { heimdallAiTools } from "@heimdallfund/agent-kit/ai-sdk";

const { text } = await generateText({
  model,
  tools: heimdallAiTools({ wallet }), // wallet adds heimdall_safe_send
  prompt: "Swap 50 USDG for NVDA",
});`,
  },
  {
    id: "langchain", label: "LangChain", lang: "ts",
    code: `import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { heimdallLangChainTools } from "@heimdallfund/agent-kit/langchain";

const agent = createReactAgent({
  llm,
  tools: heimdallLangChainTools({ wallet }),
});`,
  },
  {
    id: "eliza", label: "ElizaOS", lang: "ts",
    code: `import { heimdallPlugin } from "@heimdallfund/agent-kit/eliza";

export const character = {
  name: "Trader",
  plugins: [heimdallPlugin()],
  settings: { secrets: { HEIMDALL_API_KEY: process.env.HEIMDALL_API_KEY } },
};`,
  },
];

export const KIT_TOOLS: [string, string][] = [
  ["heimdall_check_transaction", "Simulate a transaction and get ALLOW, WARN or DENY with reasons and token moves."],
  ["heimdall_check_signature", "Judge an EIP-712 or personal_sign request: Permit, Permit2, Seaport and hidden approvals."],
  ["heimdall_wallet_check", "Every risky approval a wallet has given, with the USD each spender could take."],
  ["heimdall_agent_reputation", "How another agent has behaved under Shield: checks allowed, warned and denied."],
  ["heimdall_passport", "Heimdall Score (0-100), tier and ERC-8004 identity of another agent, before you pay or hire it."],
  ["heimdall_risk", "Risk level of any address from Heimdall's list and the onchain Risk Oracle."],
  ["heimdall_threats", "Known drainers, the most denied contracts and the community blocklist."],
  ["heimdall_pay_job", "Read a Heimdall Pay escrow job. Needs a public client and the Pay address."],
  ["heimdall_pay_record", "A provider's track record: jobs completed, disputed and USDG earned."],
  ["heimdall_safe_send", "Send from the agent's wallet only when Shield allows it. Needs a wallet; asks for approval in the AI SDK by default."],
];
