import type { Metadata } from "next";
import { CHANGELOG, type ChangeTag } from "@/lib/changelog";

export const metadata: Metadata = { title: "Changelog", description: "What changed in Heimdall, day by day: Shield, integrations, agents, security, contracts and docs. Dates in UTC." };

const TAG: Record<ChangeTag, string> = {
  Shield: "bg-brand-soft text-brand", Integrations: "bg-allow-soft text-allow", Agents: "bg-ink text-paper", Security: "bg-deny-soft text-deny",
  Web: "bg-ink-2 text-ink", Contracts: "bg-warn-soft text-warn", Docs: "bg-ice text-ink",
};
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export default function ChangelogPage() {
  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-10 px-6 pb-24 pt-12">
      <header className="flex flex-col gap-2">
        <span className="eyebrow">Trust</span><h1 className="text-[50px]">Changelog</h1>
        <p className="text-muted">What changed, newest first. Dates in UTC. The full history is in the <a className="text-brand underline underline-offset-2" href="https://github.com/heimdallfund/Heimdall/commits/main">repository</a>.</p>
      </header>
      <ol className="flex flex-col">
        {CHANGELOG.map((e, i) => (
          <li key={e.date} id={e.date} className="relative grid scroll-mt-24 gap-x-8 gap-y-3 border-l-2 border-line pb-12 pl-6 md:grid-cols-[150px_1fr] md:border-l-0 md:pl-0">
            <span className="absolute -left-[7px] top-1.5 size-3 rounded-full border-2 border-paper bg-brand md:hidden" aria-hidden />
            <a href={`#${e.date}`} className="font-mono text-[13px] font-semibold text-muted hover:text-brand md:pt-1">{day(e.date)}{i === 0 && <span className="ml-2 rounded-sm bg-brand px-1.5 py-0.5 text-[10.5px] uppercase tracking-wider text-white md:ml-0 md:mt-1 md:block md:w-fit">Latest</span>}</a>
            <article className="flex min-w-0 flex-col gap-3 md:border-l-2 md:border-line md:pl-8">
              <h2 className="text-[22px] font-semibold leading-snug">{e.title}</h2>
              <p className="text-[15.5px] leading-relaxed text-muted">{e.summary}</p>
              <ul className="mt-1 flex flex-col gap-2.5">
                {e.changes.map((c, j) => (
                  <li key={j} className="flex items-start gap-3 text-[15px] leading-relaxed">
                    <span className={`mt-[3px] w-[92px] shrink-0 rounded-sm px-2 py-0.5 text-center font-mono text-[10.5px] font-semibold uppercase tracking-wider ${TAG[c.tag]}`}>{c.tag}</span>
                    <span className="min-w-0">{c.text}</span>
                  </li>
                ))}
              </ul>
            </article>
          </li>
        ))}
      </ol>
    </div>
  );
}
