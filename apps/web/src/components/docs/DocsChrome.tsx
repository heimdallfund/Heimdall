"use client";
import { track } from "@/lib/track";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DOCS, DOCS_FLAT } from "@/lib/nav";

export function DocsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Docs" className="flex flex-col gap-6 text-[14px]">
      {DOCS.map((s) => (
        <div key={s.title} className="flex flex-col gap-0.5">
          <span className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{s.title}</span>
          {s.items.map((i) => {
            const active = path === i.href;
            return (
              <Link key={i.href} href={i.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 ${active ? "bg-brand-soft font-medium text-brand" : "text-ink/75 hover:bg-ice hover:text-ink"}`}>
                {i.title}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function DocsMobileMenu() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const current = DOCS_FLAT.find((d) => d.href === path);
  return (
    <div className="rounded-lg border border-line lg:hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between px-4 text-left text-[14px] font-medium">
        <span><span className="text-muted">{current?.section ?? "Docs"} / </span>{current?.title ?? "Overview"}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={open ? "rotate-180" : ""} aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && <div className="border-t border-line px-1 py-3"><DocsSidebar onNavigate={() => setOpen(false)} /></div>}
    </div>
  );
}

/** "On this page": built from the article's h2 headings, highlights the one in view. */
export function DocsToc() {
  const path = usePathname();
  const [items, setItems] = useState<{ id: string; text: string }[]>([]);
  const [active, setActive] = useState("");
  useEffect(() => {
    const hs = [...document.querySelectorAll<HTMLHeadingElement>("article h2[id]")];
    setItems(hs.map((h) => ({ id: h.id, text: h.textContent?.replace(/#$/, "") ?? "" })));
    const io = new IntersectionObserver((es) => {
      const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActive(vis[0].target.id);
    }, { rootMargin: "-80px 0px -65% 0px" });
    hs.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [path]);
  if (!items.length) return null;
  return (
    <nav aria-label="On this page" className="flex flex-col gap-1 text-[13px]">
      <span className="pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">On this page</span>
      {items.map((i) => (
        <a key={i.id} href={`#${i.id}`} className={`border-l-2 py-1 pl-3 ${active === i.id ? "border-brand font-medium text-brand" : "border-line text-muted hover:text-ink"}`}>{i.text}</a>
      ))}
    </nav>
  );
}

export function DocsPager() {
  const path = usePathname();
  const i = DOCS_FLAT.findIndex((d) => d.href === path);
  if (i < 0) return null;
  const prev = DOCS_FLAT[i - 1];
  const next = DOCS_FLAT[i + 1];
  const card = "flex min-w-0 flex-1 flex-col gap-1 rounded-xl border border-line p-4 transition hover:border-brand";
  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-line pt-8 sm:flex-row">
      {prev ? <Link href={prev.href} className={card}><span className="text-[12px] text-muted">Previous</span><span className="font-medium">← {prev.title}</span></Link> : <span className="flex-1" />}
      {next ? <Link href={next.href} className={`${card} sm:items-end sm:text-right`}><span className="text-[12px] text-muted">Next</span><span className="font-medium">{next.title} →</span></Link> : <span className="flex-1" />}
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label="Copy code" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); track("docs_copy"); setTimeout(() => setDone(false), 1500); } catch {} }}
      className="rounded-md px-2 py-1 text-[12px] font-medium text-muted hover:bg-panel hover:text-ink">
      {done ? "Copied" : "Copy"}
    </button>
  );
}
