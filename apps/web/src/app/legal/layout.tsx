import Link from "next/link";
import type { ReactNode } from "react";

const PAGES = [["/legal/terms", "Terms of use"], ["/legal/privacy", "Privacy"], ["/legal/risk", "Risk disclosure"]];

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-10 px-6 pb-24 pt-14 md:flex-row">
      <nav aria-label="Legal" className="flex shrink-0 gap-1 md:w-[200px] md:flex-col">
        <span className="hidden pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted md:block">Legal</span>
        {PAGES.map(([href, label]) => <Link key={href} href={href} className="rounded-lg px-3 py-2 text-[14px] text-ink/80 hover:bg-ice hover:text-ink">{label}</Link>)}
      </nav>
      <div className="card min-w-0 flex-1 p-8 md:p-10">{children}</div>
    </div>
  );
}
