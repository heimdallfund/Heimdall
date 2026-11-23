import type { Metadata } from "next";
import Link from "next/link";
import { Code, H1, H2, Note, C } from "@/components/docs/Docs";
import { PUBLIC_API_URL } from "@/lib/config";

export const metadata: Metadata = { title: "Docs", description: "Build with Heimdall: Shield transaction firewall, pay-per-call Signals and Shield-guarded vaults on Robinhood Chain." };

export default function DocsHome() {
  return (
    <>
      <H1 lead="Heimdall is the guardian layer for onchain agents on Robinhood Chain (chain ID 4663). Three products share one rule: nothing gets signed unchecked.">Build with Heimdall</H1>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
        {[
          ["/docs/shield", "Shield", "Simulate and judge any transaction before your agent signs it."],
          ["/docs/signatures", "Signature checks", "Catch Permit and Permit2 drainers that never touch the chain."],
          ["/docs/vaults", "Vaults", "Run depositor money that can only trade with a Shield receipt."],
          ["/docs/signals", "Signals", "Buy or sell market signals per call, paid in USDG."],
        ].map(([href, t, d]) => (
          <Link key={href} href={href} className="rounded-xl border border-line bg-panel p-5 transition hover:border-brand"><span className="font-semibold">{t}</span><p className="mt-1.5 text-sm text-muted">{d}</p></Link>
        ))}
      </div>

      <H2 id="quickstart">Quickstart: protect an agent in 2 minutes</H2>
      <p>1. Install the SDK.</p>
      <Code lang="bash">{`npm install @heimdall/sdk viem`}</Code>
      <p>2. Replace your agent&apos;s <C>sendTransaction</C> with <C>guardedSend</C>. It asks Shield first and only sends on ALLOW.</p>
      <Code lang="ts">{`import { HeimdallShield, guardedSend, HeimdallDenied } from "@heimdall/sdk";

const shield = new HeimdallShield({ apiKey: process.env.HEIMDALL_API_KEY }); // key optional on the free plan

try {
  const { hash } = await guardedSend(wallet, { to, data, value }, {
    shield,
    policy: { strict: true, maxNativeOut: "50000000000000000" }, // 0.05 ETH per tx
  });
} catch (e) {
  if (e instanceof HeimdallDenied) console.log(e.result.findings); // why it was blocked
}`}</Code>
      <p>3. Before your agent signs a message (Permit, Permit2, marketplace order), check it too:</p>
      <Code lang="bash">{`curl -X POST ${PUBLIC_API_URL}/v1/check-signature \\
  -H "content-type: application/json" \\
  -d '{ "signer": "0xYourAgent", "typedData": { "domain": {…}, "types": {…}, "primaryType": "Permit", "message": {…} } }'`}</Code>
      <Note>No SDK? Everything is plain HTTP. See <Link className="text-brand" href="/docs/shield">Transaction checks</Link> for the full request and response.</Note>

      <H2 id="how">How the pieces fit</H2>
      <ol className="list-decimal space-y-2 pl-5">
        <li>An agent builds a transaction (a swap, an approval, a transfer).</li>
        <li><strong>Shield</strong> simulates it on the latest Robinhood Chain block and answers ALLOW, WARN or DENY with reasons and an EIP-712 receipt valid for 120 seconds.</li>
        <li>A <strong>vault</strong> only executes a manager&apos;s trade when it carries a fresh ALLOW receipt, and checks trade size and loss with price feeds.</li>
        <li>Agents buy their edge from <strong>Signals</strong>, paying per call with gasless vouchers.</li>
      </ol>
    </>
  );
}
