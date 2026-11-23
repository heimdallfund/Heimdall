import type { Metadata } from "next";
import Link from "next/link";
import { CtaBand, SectionHead, Snippet } from "@/components/ProductSections";
import { IconTile, type IconName } from "@/components/Icons";
import { BrandLogo, type BrandName } from "@/components/BrandLogo";

export const metadata: Metadata = {
  title: "Integrate Heimdall",
  description: "Build on Heimdall: an onchain Risk Oracle, a Safe module for agent wallets, x402 payments with a checking facilitator, and ERC-8004 Agent Passports. Plus the SDK, MCP server and agent frameworks.",
};

const BLOCKS: { href: string; icon: IconName; kicker: string; title: string; text: string; who: string; code: string }[] = [
  { href: "/oracle", icon: "lock", kicker: "Contracts", title: "Risk Oracle", text: "Known drainers, phishing contracts, exploiters and honeypots on Robinhood Chain, readable by any contract in one view call. Free.", who: "DEXs, launchpads, bridges, wallets", code: "require(!heimdall.isBlocked(to));" },
  { href: "/guard", icon: "vault", kicker: "Safe module", title: "Guard for Safe", text: "Let an agent spend from a Safe only with a Shield receipt and within daily limits. The owners keep the keys.", who: "Agent platforms, treasuries, DAOs", code: "safe.enableModule(HEIMDALL_GUARD);" },
  { href: "/x402", icon: "coins", kicker: "Payments", title: "x402 in USDG", text: "Agents pay per call with a signature, no API key. Any API can settle through Heimdall's facilitator, which checks the recipient first.", who: "API sellers, agent builders", code: "payX402(fetch, wallet, { maxAmount });" },
  { href: "/passport", icon: "receipt", kicker: "ERC-8004", title: "Agent Passport", text: "A score built from Shield, Pay and the risk list, tied to ERC-8004 identity and published on the official registry.", who: "Agent marketplaces, credit, hiring", code: "registry.getSummary(id, [heimdall], \"heimdall\", \"\");" },
];

const MORE_LOGOS: Record<string, BrandName[]> = { "/docs/mcp": ["claude", "cursor", "mcp"], "/docs/frameworks": ["vercel", "langchain"], "/docs/shield": ["robinhood"] };
const MORE: [string, string, string][] = [
  ["/docs/sdk", "TypeScript SDK", "Checks, receipts, vaults, Pay, Guard, x402 and Passport in one package."],
  ["/docs/mcp", "MCP server", "Claude, Cursor and any MCP client: check transactions, risk and passports."],
  ["/docs/frameworks", "Agent frameworks", "Native tools for the Vercel AI SDK, LangChain and ElizaOS."],
  ["/docs/webhooks", "Webhooks", "Shield DENY, WARN and risky approvals pushed to your server, signed."],
  ["/badges", "Badges", "Show users your agent or vault is checked by Heimdall, live."],
  ["/docs/shield", "HTTP API", "Plain HTTP for everything else. Free tier, API keys or x402."],
];

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-12 px-5 pb-20 pt-14 md:px-8">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Integrate</span>
        <h1 className="max-w-[900px] text-[54px] md:text-[80px]">Safety your app can plug into.</h1>
        <p className="max-w-[680px] text-[18px] leading-relaxed text-muted">Heimdall is built to sit inside other products: in your contracts, in your users&apos; Safes, in your API&apos;s payment flow and in your agent&apos;s trust decisions. Pick the piece you need; each one works on its own.</p>
      </header>
      <section className="grid gap-px border border-ink bg-ink md:grid-cols-2">
        {BLOCKS.map((b) => (
          <Link key={b.href} href={b.href} className="group flex min-w-0 flex-col gap-4 bg-panel p-7 transition-colors hover:bg-paper">
            <div className="flex items-center justify-between"><IconTile name={b.icon} /><span className="label">{b.kicker}</span></div>
            <h2 className="display text-[44px]">{b.title}</h2>
            <p className="text-[15.5px] leading-relaxed text-muted">{b.text}</p>
            <code className="block overflow-x-auto border border-ink bg-ink px-4 py-3 font-mono text-[13px] text-paper">{b.code}</code>
            <div className="mt-auto flex items-center justify-between"><span className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted">For: {b.who}</span><span className="font-mono text-[13px] font-semibold text-brand group-hover:underline">Open →</span></div>
          </Link>
        ))}
      </section>
      <section className="flex flex-col gap-8">
        <SectionHead kicker="Also" title="Everything else" lead="The pieces Heimdall already runs on, open to you." />
        <div className="grid gap-px border border-ink bg-ink sm:grid-cols-2 lg:grid-cols-3">
          {MORE.map(([href, t, d]) => <Link key={href} href={href} className="flex flex-col gap-2 bg-panel p-6 hover:bg-paper"><span className="text-[17px] font-semibold">{t}</span><span className="text-[14.5px] text-muted">{d}</span>{MORE_LOGOS[href] && <span className="mt-1 flex gap-1.5">{MORE_LOGOS[href].map((n) => <BrandLogo key={n} name={n} size={24} />)}</span>}</Link>)}
        </div>
      </section>
      <section className="grid items-start gap-8 lg:grid-cols-[1fr_1.1fr]">
        <SectionHead kicker="One install" title="Start in a minute" lead="The SDK carries every integration on this page. Most of them are a single call." />
        <Snippet label="Terminal" code={"npm i @heimdallfund/sdk viem\n\n# agents in Claude or Cursor\nclaude mcp add heimdall -- npx -y @heimdallfund/mcp"} />
      </section>
      <CtaBand title="Building something bigger?" text="Tell us what you are integrating and we will help with the wiring, review your setup, and list you as a partner." primary={["mailto:hello@heimdall.fund?subject=Integrating%20Heimdall", "hello@heimdall.fund"]} secondary={["/docs", "Read the docs"]} />
    </div>
  );
}
