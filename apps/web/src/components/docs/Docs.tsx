import type { ReactNode } from "react";
import { CopyButton } from "./DocsChrome";

const LANG: Record<string, string> = { ts: "TypeScript", bash: "Terminal", json: "JSON", http: "HTTP", python: "Python" };

export function Code({ children, lang }: { children: string; lang?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-ink-2">
      <div className="flex items-center justify-between border-b border-line bg-ice px-4 py-1.5">
        <span className="text-[12px] font-medium text-muted">{lang ? LANG[lang] ?? lang : "Code"}</span>
        <CopyButton text={children} />
      </div>
      <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-[1.7] text-ink">{children}</pre>
    </div>
  );
}

export function H1({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 pb-2">
      <h1 className="text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink md:text-[36px]">{children}</h1>
      {lead && <p className="text-[17px] leading-relaxed text-muted">{lead}</p>}
    </header>
  );
}

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="group scroll-mt-24 pt-6 text-[22px] font-semibold leading-snug text-ink">
      {children}
      <a href={`#${id}`} aria-label="Link to this section" className="ml-2 text-brand opacity-0 transition group-hover:opacity-100">#</a>
    </h2>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[560px] border-collapse text-[14px] leading-relaxed">
        <thead><tr className="bg-ice text-left">{head.map((h) => <th key={h} className="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-ink">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line first:border-t-0">{r.map((c, j) => <td key={j} className={`px-4 py-2.5 align-top ${j === 0 ? "font-mono text-[13px] text-ink" : "text-ink/75"}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** GitBook-style hint block. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl bg-brand-soft px-4 py-3.5 text-[15px] leading-relaxed text-ink">
      <svg className="mt-1 shrink-0 text-brand" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
      <div>{children}</div>
    </div>
  );
}

export const C = ({ children }: { children: ReactNode }) => <code className="rounded-md border border-line bg-ink-2 px-1.5 py-px font-mono text-[13px] text-ink">{children}</code>;
