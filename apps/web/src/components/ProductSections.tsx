import Link from "next/link";
import { Reveal } from "./Reveal";
import { IconTile, type IconName } from "./Icons";

export function Steps({ title, steps }: { title: string; steps: [IconName, string, string][] }) {
  return (
    <section className="py-20">
      <Reveal><span className="font-mono text-[12px] font-semibold tracking-[0.12em] text-muted">HOW IT WORKS <span className="text-brand">//</span></span><h2 className="display mb-10 mt-3 text-[52px] md:text-[64px]">{title}</h2></Reveal>
      <ol className="grid border-l border-t border-ink md:grid-cols-3">
        {steps.map(([icon, t, d], i) => (
          <li key={t} className="list-none border-b border-r border-ink bg-panel"><Reveal delay={i * 80} className="h-full">
            <div className="flex h-full flex-col gap-3 p-6">
              <div className="flex items-center justify-between"><IconTile name={icon} /><span className="display text-[40px] text-ink/15">0{i + 1}</span></div>
              <span className="mt-1 text-[18px] font-semibold">{t}</span>
              <span className="text-[15px] leading-relaxed text-muted">{d}</span>
            </div>
          </Reveal></li>
        ))}
      </ol>
    </section>
  );
}

export function Faq({ items }: { items: [string, string][] }) {
  return (
    <section className="grid gap-8 py-16 lg:grid-cols-[1fr_1.6fr]">
      <Reveal><span className="font-mono text-[12px] font-semibold tracking-[0.12em] text-muted">FAQ <span className="text-brand">//</span></span><h2 className="display mt-3 text-[52px] md:text-[64px]">Questions,<br />answered.</h2></Reveal>
      <div className="border-t border-ink">
        {items.map(([q, a]) => (
          <details key={q} className="group border-b border-ink py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold">{q}<span className="font-mono text-[22px] font-normal text-brand transition group-open:rotate-45">+</span></summary>
            <p className="mt-3 max-w-[640px] text-[15.5px] leading-relaxed text-muted">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function CtaBand({ title, text, primary, secondary }: { title: string; text: string; primary: [string, string]; secondary?: [string, string] }) {
  return (
    <Reveal>
      <div className="my-12 grid items-end gap-6 border border-ink bg-panel p-8 shadow-[6px_6px_0_var(--color-ink)] md:grid-cols-[1.4fr_1fr] md:p-10">
        <div>
          <h2 className="display text-[48px] md:text-[60px]">{title}</h2>
          <p className="mt-3 max-w-[540px] text-[16px] text-muted">{text}</p>
        </div>
        <div className="flex flex-wrap gap-3 md:justify-end">
          <Link href={primary[0]} className="btn btn-primary">{primary[1]} →</Link>
          {secondary && <Link href={secondary[0]} className="btn btn-secondary">{secondary[1]}</Link>}
        </div>
      </div>
    </Reveal>
  );
}
