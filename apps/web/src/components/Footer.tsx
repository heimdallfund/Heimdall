import Link from "next/link";
import { Logo } from "./Logo";
import { StatusPill } from "./StatusPill";
import { BrandLogo } from "@/components/BrandLogo";

const social = [
  { href: process.env.NEXT_PUBLIC_X_URL ?? "https://x.com/HeimdallFund", label: "Heimdall on X", path: "M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" },
  { href: "https://github.com/heimdallfund/Heimdall", label: "Heimdall on GitHub", path: "M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.38-3.37-1.38-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.57 2.34 1.12 2.91.85.09-.66.35-1.12.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.36 9.36 0 0 1 12 6.98c.85 0 1.71.12 2.51.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.64 1.03 2.76 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.13 10.13 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" },
];

/** The short list: everything else is one tap away in the header menu. */
const cols: [string, [string, string][]][] = [
  ["Products", [["/check", "Wallet Check"], ["/token-check", "Token Check"], ["/radar", "Launch Radar"], ["/shield", "Shield"], ["/vaults", "Vaults"], ["/pay", "Pay"], ["/token", "$HEIM"]]],
  ["Build", [["/integrate", "Integrate"], ["/docs", "Docs"], ["/docs/sdk", "SDK"], ["/docs/mcp", "MCP server"], ["/docs/contracts", "Contracts"]]],
  ["Trust", [["/security", "Security"], ["/status", "Status"], ["/trust", "Trust center"], ["/threats", "Threat Board"], ["/changelog", "Changelog"], ["/brand", "Brand kit"]]],
];
const legal: [string, string][] = [["/legal/terms", "Terms"], ["/legal/privacy", "Privacy"], ["/legal/risk", "Risk disclosure"]];

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
          <div className="flex gap-2">
              {social.map((s) => (
                <a key={s.label} href={s.href} aria-label={s.label} className="inline-flex size-9 items-center justify-center border border-paper/25 text-paper/80 hover:border-paper hover:text-paper">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={s.path} /></svg>
                </a>
              ))}
          </div>
        </div>
        <nav aria-label="Footer" className="grid w-full grid-cols-3 gap-x-6 gap-y-8 text-sm sm:w-auto sm:gap-x-16">
          {cols.map(([title, links]) => (
            <div key={title} className="flex flex-col gap-2.5">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-paper/60">{title}</span>
              {links.map(([href, label]) => <Link key={href} href={href} className="text-paper/80 hover:text-paper hover:underline hover:underline-offset-4">{label}</Link>)}
            </div>
          ))}
        </nav>
      </div>
      <div className="mx-auto flex max-w-[1280px] flex-wrap justify-between gap-3 border-t border-paper/15 px-6 py-5 font-mono text-[11px] uppercase tracking-[0.1em] text-paper/60">
        <span className="flex flex-wrap gap-x-4 gap-y-2"><span>© 2026 Heimdall · Not investment advice</span>{legal.map(([href, label]) => <Link key={href} href={href} className="hover:text-paper hover:underline hover:underline-offset-4">{label}</Link>)}</span>
        <span className="inline-flex items-center gap-2"><BrandLogo name="robinhood" size={16} />Robinhood Chain · chain ID 4663</span>
      </div>
    </footer>
  );
}
