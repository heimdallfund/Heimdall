import type { Metadata } from "next";
import { Code, H1, H2, Note, Table } from "@/components/docs/Docs";
import { ClientTabs } from "@/components/docs/ClientTabs";
import { FRAMEWORKS, KIT_TOOLS } from "@/lib/frameworks";

export const metadata: Metadata = {
  title: "Agent frameworks",
  description: "@heimdallfund/agent-kit: Heimdall Shield and Pay as native tools for the Vercel AI SDK, LangChain and ElizaOS.",
};

export default function Page() {
  return (
    <>
      <H1 lead="Native Heimdall tools for the Vercel AI SDK, LangChain and ElizaOS. Same names, inputs and answers in every framework, and no MCP server to run.">Agent frameworks</H1>
      <H2 id="install">Install</H2>
      <Code lang="bash">{"npm i @heimdallfund/agent-kit"}</Code>
      <p className="text-[15px] leading-relaxed text-muted">Install the framework you already use next to it. The kit only loads the adapter you import.</p>
      <H2 id="use">Add it to your agent</H2>
      <ClientTabs tabs={FRAMEWORKS.map((f) => ({ id: f.id, label: f.label, pane: <Code lang={f.lang}>{f.code}</Code> }))} />
      <Note>Answers are kept short for the model: the verdict, the reasons that matter and what each token does, plus a line of advice. A DENY always says not to sign.</Note>
      <H2 id="tools">Tools</H2>
      <Table head={["Tool", "What it does"]} rows={KIT_TOOLS.map(([n, d]) => [<code key={n} className="font-mono text-[13px]">{n}</code>, d])} />
      <H2 id="options">Options</H2>
      <Table head={["Option", "Meaning"]} rows={[
        ["apiKey, baseUrl", "Shield API key and URL. Without a key you get the free tier."],
        ["policy", "Policy applied to every check: spend caps, allowed targets, trusted spenders."],
        ["wallet", "The agent's viem wallet. Adds heimdall_safe_send."],
        ["allowWarn", "Let heimdall_safe_send go ahead on WARN. Off by default."],
        ["approveSends", "AI SDK only: pause for human approval before heimdall_safe_send. On by default."],
        ["publicClient, payAddress", "Turns on the Heimdall Pay tools."],
        ["only", "Pick tools by name."],
      ]} />
      <H2 id="eliza">ElizaOS settings</H2>
      <p className="text-[15px] leading-relaxed text-muted">The plugin reads <code className="font-mono text-[13px] text-ink">HEIMDALL_API_URL</code>, <code className="font-mono text-[13px] text-ink">HEIMDALL_API_KEY</code> and <code className="font-mono text-[13px] text-ink">HEIMDALL_PAY_ADDRESS</code> from the character or the environment. Each tool becomes an action with typed parameters, such as <code className="font-mono text-[13px] text-ink">HEIMDALL_CHECK_TRANSACTION</code>.</p>
    </>
  );
}
