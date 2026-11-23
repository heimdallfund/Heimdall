"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Icon } from "../Icons";

export interface Audience { id: string; label: string; title: string; text: string; points: string[]; cta: [string, string]; visual: ReactNode }

/** "Built for" tabs: one panel per audience, keyboard accessible. */
export function AudienceTabs({ items }: { items: Audience[] }) {
  const [active, setActive] = useState(0);
  const a = items[active];
  return (
    <div>
      <div role="tablist" aria-label="Built for" className="flex max-w-[720px] border border-ink bg-panel">
        {items.map((x, i) => (
          <button key={x.id} role="tab" type="button" aria-selected={i === active} aria-controls={`panel-${x.id}`} id={`tab-${x.id}`}
            onClick={() => setActive(i)}
            onKeyDown={(e) => { if (e.key === "ArrowRight") setActive((active + 1) % items.length); if (e.key === "ArrowLeft") setActive((active + items.length - 1) % items.length); }}
            className={`min-h-12 flex-1 border-r border-ink px-2 font-mono text-[11.5px] font-semibold uppercase tracking-[0.08em] transition last:border-r-0 sm:px-3 sm:text-[12.5px] ${i === active ? "bg-ink text-paper" : "text-muted hover:bg-ice hover:text-ink"}`}>
            {x.label}
          </button>
        ))}
      </div>
      <div key={a.id} role="tabpanel" id={`panel-${a.id}`} aria-labelledby={`tab-${a.id}`} className="page-in mt-10 grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-5">
          <h3 className="display text-[44px] sm:text-[52px]">{a.title}</h3>
          <p className="text-[16.5px] leading-relaxed text-muted">{a.text}</p>
          <ul className="flex flex-col gap-3">
            {a.points.map((p) => <li key={p} className="flex items-start gap-3 text-[15.5px]"><span className="mt-0.5 font-mono text-[14px] font-bold text-allow">✓</span>{p}</li>)}
          </ul>
          <Link href={a.cta[0]} className="btn btn-primary self-start">{a.cta[1]} <Icon name="arrow" size={16} /></Link>
        </div>
        <div className="flex min-w-0 justify-center">{a.visual}</div>
      </div>
    </div>
  );
}
