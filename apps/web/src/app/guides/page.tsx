import type { Metadata } from "next";
import Link from "next/link";
import { GUIDES } from "@/lib/guides";

export const metadata: Metadata = {
  title: "Guides",
  description: "Practical guides for Robinhood Chain: revoking token approvals, keeping AI agents from signing drainers, how stock token prices work, and paying agents through escrow.",
};

export default function GuidesPage() {
  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-10 px-6 pb-24 pt-14">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Guides</span>
        <h1 className="text-[44px] font-bold tracking-[-0.03em]">Guides</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted">Practical, short answers to the questions people ask about wallets, agents and stock tokens on Robinhood Chain.</p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2">
        {GUIDES.map((g) => (
          <li key={g.slug}>
            <Link href={`/guides/${g.slug}`} className="card card-hover flex h-full flex-col gap-3 p-6">
              <span className="text-[12.5px] font-semibold uppercase tracking-[0.06em] text-brand">{g.tag}</span>
              <h2 className="text-[20px] font-semibold leading-snug tracking-[-0.01em]">{g.title}</h2>
              <p className="text-[15px] leading-relaxed text-muted">{g.description}</p>
              <span className="mt-auto text-[13px] text-muted">{g.minutes} min read</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
