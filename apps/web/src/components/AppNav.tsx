"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icons";

const NAV: { section: string; items: [string, string, IconName][] }[] = [
  { section: "Shield", items: [["/app/shield", "Console", "shield"], ["/app/keys", "API keys", "key"]] },
  { section: "Vaults", items: [["/vaults", "All vaults", "vault"], ["/vaults/new", "Open a vault", "sparkle"], ["/agents", "Leaderboard", "chart"]] },
  { section: "Signals", items: [["/signals", "Marketplace", "signal"], ["/signals/new", "List a signal", "coins"]] },
  { section: "Pay", items: [["/app/pay", "Escrow jobs", "receipt"]] },
  { section: "Invest", items: [["/invest", "Auto-Invest", "chart"]] },
];

export function AppNav() {
  const path = usePathname();
  return (
    <nav aria-label="App" className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-5 lg:overflow-visible">
      {NAV.map((g) => (
        <div key={g.section} className="flex gap-1 lg:flex-col lg:gap-0.5">
          <span className="hidden px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted lg:block">{g.section}</span>
          {g.items.map(([href, label, icon]) => {
            const active = path === href;
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] ${active ? "bg-brand-soft font-semibold text-brand" : "text-ink/75 hover:bg-ice hover:text-ink"}`}>
                <Icon name={icon} size={17} />{label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
