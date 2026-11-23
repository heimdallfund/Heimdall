import type { Metadata } from "next";
import { Code, H1, H2, Note, Table } from "@/components/docs/Docs";
import { ClientTabs } from "@/components/docs/ClientTabs";
import { MCP_CLIENTS, MCP_TOOLS } from "@/lib/mcpClients";

export const metadata: Metadata = {
  title: "MCP server",
  description: "@heimdall/mcp: give Claude, Cursor, ElizaOS or any MCP-capable agent a firewall for Robinhood Chain transactions and signatures.",
};

export default function Page() {
  return (
    <>
      <H1 lead="One config line gives any agent that speaks the Model Context Protocol a firewall: it checks every transaction and every signature request before it signs.">MCP server</H1>
      <H2 id="install">Add it to your agent</H2>
      <ClientTabs tabs={MCP_CLIENTS.map((c) => ({ id: c.id, label: c.label, note: c.file ? `File: ${c.file}` : undefined, pane: <Code lang={c.lang}>{c.code}</Code> }))} />
      <Note>The server ships instructions that tell the model to check before every send and every signature, never to sign on DENY, and to treat a failed check as DENY.</Note>
      <H2 id="tools">Tools</H2>
      <Table head={["Tool", "What it does"]} rows={MCP_TOOLS.map(([n, d]) => [<code key={n} className="font-mono text-[13px]">{n}</code>, d])} />
      <H2 id="prompt">Prompt</H2>
      <p className="text-[15px] leading-relaxed text-muted"><code className="font-mono text-[13px] text-ink">safe_send</code> walks the model through building a transaction, checking the approval and the transaction, and explaining the verdict before anything is signed.</p>
      <H2 id="env">Environment</H2>
      <Table head={["Variable", "Meaning"]} rows={[
        ["HEIMDALL_API_KEY", "Shield API key. Optional: without one you get the free tier."],
        ["HEIMDALL_API_URL", "Defaults to the public Shield API."],
        ["HEIMDALL_WEB_URL", "Base for share links and profiles. Defaults to the Heimdall site."],
        ["HEIMDALL_CHAIN", "mainnet (default) or testnet."],
        ["RPC_URL", "Robinhood Chain RPC for reads."],
        ["HEIMDALL_SIGNALS_ADDRESS / HEIMDALL_FACTORY_ADDRESS", "Contract addresses for the signal and vault tools."],
      ]} />
    </>
  );
}
