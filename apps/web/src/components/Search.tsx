"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { SEARCH } from "@/lib/nav";

function SearchIcon({ className = "" }: { className?: string }) {
  return <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}

/** GitBook-style search: button in the header, ⌘K / Ctrl+K / "/" opens a palette over every page and docs section. */
export function Search() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return SEARCH.slice(0, 9);
    return SEARCH.filter((e) => `${e.title} ${e.section} ${e.keywords ?? ""}`.toLowerCase().includes(t)).slice(0, 12);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  const go = (href: string) => { setOpen(false); router.push(href); };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Search"
        className="flex min-h-10 items-center gap-2 border border-ink/20 bg-panel px-3 font-mono text-[12px] uppercase tracking-[0.06em] text-muted transition hover:border-ink md:w-[180px] 2xl:w-[220px]">
        <SearchIcon />
        <span className="hidden md:inline">Search…</span>
        <kbd className="ml-auto hidden rounded border border-line bg-panel px-1.5 font-sans text-[11px] md:inline">⌘K</kbd>
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/25 px-4 pt-[12vh]" onClick={() => setOpen(false)} role="presentation">
          <div role="dialog" aria-modal="true" aria-label="Search" onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[600px] overflow-hidden rounded-xl border border-line bg-panel border-ink shadow-[6px_6px_0_var(--color-ink)]">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <SearchIcon className="text-muted" />
              <input ref={input} value={q} placeholder="Search pages and docs"
                onChange={(e) => { setQ(e.target.value); setSel(0); }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                  else if (e.key === "Enter" && results[sel]) go(results[sel].href);
                }}
                className="min-h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted" />
              <kbd className="rounded border border-line px-1.5 text-[11px] text-muted">Esc</kbd>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-2">
              {results.length === 0 && <li className="px-3 py-6 text-center text-muted">No results for “{q}”.</li>}
              {results.map((r, i) => (
                <li key={r.href}>
                  <button type="button" onMouseEnter={() => setSel(i)} onClick={() => go(r.href)}
                    className={`flex w-full flex-col items-start rounded-lg px-3 py-2.5 text-left ${i === sel ? "bg-brand-soft" : ""}`}>
                    <span className={`font-medium ${i === sel ? "text-brand" : ""}`}>{r.title}</span>
                    <span className="text-[13px] text-muted">{r.section}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
