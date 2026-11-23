"use client";
import { useState } from "react";

export function SnippetCopy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label="Copy code" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ } }}
      className="inline-flex min-h-8 items-center px-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-paper/70 hover:text-paper">
      {done ? "Copied" : "Copy"}
    </button>
  );
}
