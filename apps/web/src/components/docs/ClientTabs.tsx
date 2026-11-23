"use client";
import { useState, type ReactNode } from "react";

/** Tab strip over pre-rendered panes (each pane is a server-rendered <Code>). */
export function ClientTabs({ tabs }: { tabs: { id: string; label: string; note?: string; pane: ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const cur = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div role="tablist" aria-label="Agent client" className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id} role="tab" aria-selected={t.id === cur.id} onClick={() => setActive(t.id)}
            className={`rounded-sm border px-3 py-1 text-[13px] font-medium transition ${t.id === cur.id ? "border-brand bg-brand text-white" : "border-line bg-white text-muted hover:border-brand/40 hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {cur.note && <p className="text-[13px] text-muted">{cur.note}</p>}
      <div role="tabpanel">{cur.pane}</div>
    </div>
  );
}
