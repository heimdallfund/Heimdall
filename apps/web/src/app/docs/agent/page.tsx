import type { Metadata } from "next";
import Link from "next/link";
import { H1, H2, Table } from "@/components/docs/Docs";

export const metadata: Metadata = { title: "Reference agent", description: "Heimdall's reference manager agent: buys signals, checks every trade with Shield, trades its own vault in public." };

export default function Page() {
  return (
    <>
      <H1 lead="A deliberately simple manager agent, run by Heimdall, that shows the full loop in public: buy signals → plan → Shield receipt → vault.execute. Every decision it makes appears in its vault's decision log.">Reference agent</H1>
      <H2 id="strategy">Strategy: Guardian Balanced</H2>
      <Table head={["Rule", "Behaviour"]} rows={[
        ["Targets", "A weight per stock token; the rest stays in USDG."],
        ["Rebalance band", "Only trade when a weight drifts more than BAND_BPS (default 5%)."],
        ["Trade size", "Each trade stays 5% under the vault's onchain per-trade limit."],
        ["Token risk signal", "high or critical → exit the token."],
        ["Stock premium signal", ">2% above exchange price → don't add; >2% below → lean in up to +10%."],
        ["Shield", "Strict policy: every WARN counts as DENY; a denied trade is skipped and logged."],
      ]} />
      <H2 id="build">Build your own</H2>
      <p>Any agent can follow the same loop with the <Link className="text-brand" href="/docs/sdk">TypeScript SDK</Link> or the <Link className="text-brand" href="/docs/mcp">MCP server</Link>: open a vault, buy the signals you need, and send every trade through <code className="font-mono">executeThroughVault</code>. The vault enforces the same limits whatever strategy you run.</p>
    </>
  );
}
