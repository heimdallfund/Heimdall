import Link from "next/link";
import { Logo } from "./Logo";
import { StatusPill } from "./StatusPill";
import { BrandLogo } from "@/components/BrandLogo";

const social = [
  { href: process.env.NEXT_PUBLIC_X_URL, label: "X", path: "M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" },
].filter((s) => s.href);

const cols: [string, [string, string][]][] = [
  ["Products", [["/check", "Wallet Check"], ["/shield", "Shield"], ["/signals", "Signals"], ["/vaults", "Vaults"], ["/pay", "Pay"], ["/invest", "Auto-Invest"], ["/arena", "Agent Arena"], ["/agents", "Agents"], ["/points", "Guardian Points"], ["/token", "$HEIM"], ["/stake", "Stake $HEIM"]]],
  ["Build", [["/integrate", "Integrate"], ["/oracle", "Risk Oracle"], ["/guard", "Guard for Safe"], ["/x402", "x402 payments"], ["/passport", "Agent Passport"], ["/docs", "Docs"], ["/guides", "Guides"], ["/docs/shield", "API reference"], ["/docs/sdk", "TypeScript SDK"], ["/docs/mcp", "MCP server"], ["/docs/contracts", "Contracts"], ["/badges", "Badges"], ["/brand", "Brand kit"]]],
  ["Trust", [["/security", "Security"], ["/status", "Status"], ["/trust", "Trust center"], ["/threats", "Threat Board"], ["/legal/terms", "Terms"], ["/legal/privacy", "Privacy"], ["/legal/risk", "Risk disclosure"]]],
];

export function Footer() {
  return (
    <footer className="bg-ink text-paper">
      <div className="mx-auto max-w-[1280px] px-6 pt-16">
        <p className="display text-[13vw] leading-[0.85] sm:text-[88px] lg:text-[112px]">Nothing gets<br />signed <span className="text-peri">unchecked.</span></p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/app/shield" className="btn btn-primary shadow-[3px_3px_0_var(--color-peri)] hover:shadow-[4px_4px_0_var(--color-peri)]">Protect an agent →</Link>
          <Link href="/check" className="btn border border-paper/40 text-paper hover:bg-paper hover:text-ink">Check a wallet</Link>
        </div>
      </div>
      <div className="mx-auto mt-16 flex max-w-[1280px] flex-wrap justify-between gap-12 border-t border-paper/15 px-6 pb-10 pt-12">
        <div className="flex max-w-xs flex-col gap-4">
          <Logo size={28} light />
          <span className="text-sm leading-relaxed text-paper/65">The guardian layer for onchain agents on Robinhood Chain.</span>
          <StatusPill />
          {social.length > 0 && (
            <div className="flex gap-2">
              {social.map((s) => (
                <a key={s.label} href={s.href} aria-label={s.label} className="inline-flex size-9 items-center justify-center border border-paper/25 text-paper/80 hover:border-paper hover:text-paper">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={s.path} /></svg>
                </a>
              ))}
            </div>
          )}
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-16 gap-y-8 text-sm sm:grid-cols-3">
          {cols.map(([title, links]) => (
            <div key={title} className="flex flex-col gap-2.5">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-paper/60">{title}</span>
              {links.map(([href, label]) => <Link key={href} href={href} className="text-paper/80 hover:text-paper hover:underline hover:underline-offset-4">{label}</Link>)}
            </div>
          ))}
        </nav>
      </div>
      <div className="mx-auto flex max-w-[1280px] flex-wrap justify-between gap-3 border-t border-paper/15 px-6 py-5 font-mono text-[11px] uppercase tracking-[0.1em] text-paper/60">
        <span>© 2026 Heimdall · Not investment advice</span>
        <span className="inline-flex items-center gap-2"><BrandLogo name="robinhood" size={16} />Robinhood Chain · chain ID 4663</span>
      </div>
    </footer>
  );
}
