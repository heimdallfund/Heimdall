import type { Metadata } from "next";
import Link from "next/link";
import { Code, H1, H2, Table } from "@/components/docs/Docs";

export const metadata: Metadata = { title: "TypeScript SDK", description: "@heimdallfund/sdk: Shield client, guardedSend, vault execution and signal vouchers." };

export default function Page() {
  return (
    <>
      <H1 lead="@heimdallfund/sdk wraps the API and contracts for agents written in TypeScript. Built on viem.">TypeScript SDK</H1>
      <Code lang="bash">{`npm install @heimdallfund/sdk viem`}</Code>
      <H2 id="api">API</H2>
      <Table head={["Export", "Use"]} rows={[
        ["new HeimdallShield({ apiKey, baseUrl })", "Client for the Shield API: check(tx, policy), signer()."],
        ["guardedSend(wallet, tx, { shield, policy, allowWarn })", "Checks, then sends only on ALLOW (or WARN if allowed). Throws HeimdallDenied."],
        ["executeThroughVault(wallet, { vault, target, data }, { shield })", "Manager flow: Shield check as the vault, then vault.execute with the receipt."],
        ["receiptArgs(receipt)", "Converts an API receipt into execute() arguments."],
        ["signVoucher(wallet, { chainId, signals, signalId, cumulativeAmount })", "Signs a cumulative signals voucher."],
        ["encodeVoucherHeader / decodeVoucherHeader", "x-heimdall-voucher header encoding."],
        ["verifyVoucher(client, …)", "Provider-side voucher check against onchain balance and claims."],
        ["gateVoucher(config, header) / MemoryLedger", "402 payment gate for signal endpoints."],
        ["heimdallVaultAbi, heimdallVaultFactoryAbi, heimdallSignalsAbi", "Contract ABIs."],
        ["robinhoodChain, robinhoodChainTestnet, USDG", "Chain definitions and the USDG address."],
      ]} />
      <H2 id="example">Example: manager agent</H2>
      <Code lang="ts">{`import { HeimdallShield, executeThroughVault, HeimdallDenied } from "@heimdallfund/sdk";

const shield = new HeimdallShield({ apiKey: process.env.HEIMDALL_API_KEY });
try {
  const { hash, result } = await executeThroughVault(manager, { vault, target: router, data: swap }, { shield, policy: { strict: true } });
  console.log("traded", hash, result.summary);
} catch (e) {
  if (e instanceof HeimdallDenied) console.log("Shield said no:", e.result.findings);
}`}</Code>
      <H2 id="integrations">Integrations</H2>
      <Table head={["Function", "What it does"]} rows={[
        [<code key="a" className="font-mono">payX402(fetch, wallet, &#123; maxAmount &#125;)</code>, <>A fetch that pays x402 402s in USDG, up to your cap per call. <Link className="text-brand" href="/docs/x402">x402</Link></>],
        [<code key="b" className="font-mono">shield.risk(address) · readRisk(client, oracle, address)</code>, <>Risk level from the API, or straight from the onchain oracle. <Link className="text-brand" href="/docs/risk-oracle">Risk Oracle</Link></>],
        [<code key="c" className="font-mono">guardSetupCalls(safe, setup) · safeBatch(…)</code>, <>The Safe transactions that enable Heimdall Guard for an agent. <Link className="text-brand" href="/docs/guard">Guard</Link></>],
        [<code key="d" className="font-mono">executeThroughGuard(wallet, &#123; module, safe, to, data &#125;, &#123; shield &#125;)</code>, "Run an agent call through the Guard module with a Shield receipt."],
        [<code key="e" className="font-mono">shield.passport(id) · shield.linkPassport(address, agentId)</code>, <>Agent Passport and ERC-8004 linking. <Link className="text-brand" href="/docs/passport">Passport</Link></>],
        [<code key="f" className="font-mono">heimdallScore(client, agentId, publisher)</code>, "Heimdall's score straight from the ERC-8004 Reputation Registry."],
      ]} />
    </>
  );
}
