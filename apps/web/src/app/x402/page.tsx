import type { Metadata } from "next";
import { Suspense } from "react";
import { PUBLIC_API_URL } from "@/lib/config";
import { fetchX402Stats } from "@/lib/shield";
import { CtaBand, Faq, SectionHead, Snippet, Steps } from "@/components/ProductSections";
import { LogoRow } from "@/components/BrandLogo";

export const metadata: Metadata = {
  title: "x402: pay per call in USDG",
  description: "Agents pay Heimdall per call in USDG on Robinhood Chain, no API key. API builders use Heimdall's x402 facilitator, which checks every recipient with Shield before it settles.",
};

const AGENT = `import { payX402, HeimdallShield } from "@heimdallfund/sdk";

// at most 0.01 USDG per call; the wallet needs USDG, no ETH
const fetchPaid = payX402(fetch, agentWallet, { maxAmount: 10_000n });
const shield = new HeimdallShield({ fetch: fetchPaid });

await shield.check({ from, to, data, value }); // free tier first, then paid`;

const SERVER = `// your API: answer 402, then let Heimdall verify and settle
const accepts = [{
  scheme: "exact", network: "eip155:4663",
  asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", // USDG
  amount: "10000", payTo: YOUR_WALLET, maxTimeoutSeconds: 60,
  extra: { name: "Global Dollar", version: "1" },
}];

const r = await fetch("${PUBLIC_API_URL}/x402/settle", {
  method: "POST",
  body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: accepts[0] }),
}).then((r) => r.json()); // { success, transaction, payer }`;

const MCP = `{
  "mcpServers": {
    "heimdall": {
      "command": "npx",
      "args": ["-y", "@heimdallfund/mcp"],
      "env": { "HEIMDALL_X402_PRIVATE_KEY": "0x…", "HEIMDALL_X402_MAX": "5000" }
    }
  }
}`;

async function Live() {
  const s = await fetchX402Stats();
  const usd = (raw?: string) => (raw ? `$${(Number(raw) / 1e6).toFixed(3)}` : "—");
  const cells: [string, string][] = [
    ["Transaction check", usd(s?.prices.check ?? "1000")],
    ["Signature check", usd(s?.prices.check ?? "1000")],
    ["Wallet Check", usd(s?.prices.wallet ?? "2000")],
    ["Payments settled", s?.enabled ? String(s.settled + s.paidShieldCalls) : "At launch"],
  ];
  return (
    <section className="grid gap-px border border-ink bg-ink sm:grid-cols-2 lg:grid-cols-4">
      {cells.map(([k, v]) => <div key={k} className="flex flex-col gap-2 bg-panel p-5"><span className="label">{k}</span><span className="display text-[44px]">{v}</span></div>)}
    </section>
  );
}

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-10 px-5 pb-20 pt-14 md:px-8">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">x402 · USDG on Robinhood Chain</span>
        <h1 className="max-w-[860px] text-[50px] md:text-[68px]">Pay per call. No account, no API key.</h1>
        <p className="max-w-[680px] text-[18px] leading-relaxed text-muted">Agents pay for Shield in USDG with a signature: the payment is the login. And any API on Robinhood Chain can take x402 payments through Heimdall&apos;s facilitator, the only one that checks the recipient with Shield before money moves.</p>
        <LogoRow className="mt-2" items={[{ token: "USDG", label: "USDG" }, { brand: "robinhood", label: "Robinhood Chain" }, { brand: "coinbase", label: "x402 standard" }]} />
      </header>
      <Suspense fallback={null}><Live /></Suspense>
      <Steps title="How a paid call works" steps={[
        ["signal", "402 with a price", "When the free tier is used up, the API answers 402 Payment Required with the price, the asset (USDG) and where to pay."],
        ["key", "The agent signs", "The agent signs a USDG transfer authorization (EIP-3009). No gas for the agent, and it can never be charged more than it signed."],
        ["allow", "Settled, then served", "Heimdall checks the recipient, settles the transfer onchain in about a second, and the request goes through."],
      ]} />
      <section className="flex flex-col gap-8">
        <SectionHead kicker="For agents" title="Pay for Shield" lead="Wrap fetch once. The SDK pays only when an API asks, and never above the cap you set." />
        <div className="grid gap-8 lg:grid-cols-2"><Snippet label="TypeScript SDK" code={AGENT} /><Snippet label="MCP (Claude, Cursor)" code={MCP} /></div>
      </section>
      <section className="flex flex-col gap-8">
        <SectionHead kicker="For API builders" title="A facilitator that checks first" lead="Standard x402 v2 endpoints. Before it settles, the facilitator refuses payments to addresses on Heimdall's blocklist, so a hijacked payTo never gets paid." />
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <Snippet label="Your server" code={SERVER} />
          <div className="border border-ink bg-panel">
            {[["GET", "/x402/supported", "Networks, schemes and the settling address"], ["POST", "/x402/verify", "Check a payment, move nothing"], ["POST", "/x402/settle", "Verify again, then settle onchain"], ["GET", "/discovery/resources", "Paid APIs on Robinhood Chain (Bazaar)"]].map(([m, p, d]) => (
              <div key={p} className="flex flex-col gap-1 border-b border-line px-5 py-4 last:border-b-0"><span className="font-mono text-[13px]"><b className="text-brand">{m}</b> {p}</span><span className="text-[13.5px] text-muted">{d}</span></div>
            ))}
          </div>
        </div>
      </section>
      <Faq items={[
        ["Does the agent need ETH?", "No. The agent only signs; Heimdall's facilitator submits the transfer and pays the gas."],
        ["Can a server charge more than it said?", "No. The signature fixes the exact amount, the recipient and a short expiry. The SDK also refuses any price above your cap."],
        ["Is the free tier still free?", "Yes. x402 starts when the free limit is used up, as an alternative to an API key. API keys keep working the same way."],
        ["What does the facilitator cost?", "Nothing for now: Heimdall pays the gas. Payments below 0.001 USDG are not settled, so nobody can make it burn gas on dust."],
        ["Which x402 versions?", "v2 (PAYMENT-SIGNATURE header, eip155:4663) and v1 bodies (X-PAYMENT, network \"robinhood\"), exact scheme with EIP-3009. USDG's signing domain is \"Global Dollar\", version \"1\"."],
      ]} />
      <CtaBand title="Plug your API into agents" text="Use the facilitator from any x402 server, and your endpoints show up in discovery." primary={["/docs/x402", "Read the docs"]} secondary={["/integrate", "All integrations"]} />
    </div>
  );
}
