"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export interface RecentCheck { address: string; symbol: string; verdict: "ALLOW" | "WARN" | "DENY"; at: number }
const KEY = "heimdall:token-checks";

export function readRecent(): RecentCheck[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.slice(0, 8) : []; } catch { return []; }
}

/** Share and copy buttons for a report; also remembers the check in this browser for the recent list. */
export function TokenCheckShare({ check }: { check: RecentCheck }) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl(location.href.split("?")[0]);
    try {
      const rest = readRecent().filter((c) => c.address.toLowerCase() !== check.address.toLowerCase());
      localStorage.setItem(KEY, JSON.stringify([check, ...rest].slice(0, 8)));
    } catch { /* storage blocked */ }
  }, [check]);
  const line = check.verdict === "DENY" ? `Heimdall Token Check says do not buy ${check.symbol} on Robinhood Chain.`
    : check.verdict === "WARN" ? `Heimdall Token Check flags ${check.symbol} on Robinhood Chain: be careful.`
    : `${check.symbol} passes Heimdall Token Check on Robinhood Chain: buy, sell and transfer all work.`;
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* no clipboard */ }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <a href={`https://x.com/intent/tweet?text=${encodeURIComponent(line)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noopener" className="btn btn-secondary min-h-10 px-4">Share on X</a>
      <button type="button" onClick={copy} className="btn btn-secondary min-h-10 px-4" aria-live="polite">{copied ? "Link copied" : "Copy link"}</button>
    </div>
  );
}

const TONE = { ALLOW: "bg-allow-soft text-allow", WARN: "bg-warn-soft text-warn", DENY: "bg-deny-soft text-deny" } as const;

/** Tokens this browser checked recently. Renders nothing until there is one. */
export function RecentChecks() {
  const [items, setItems] = useState<RecentCheck[]>([]);
  useEffect(() => { setItems(readRecent()); }, []);
  if (!items.length) return null;
  return (
    <div className="flex w-full max-w-[640px] flex-col gap-2 text-left">
      <span className="label">Your recent checks</span>
      <ul className="flex flex-wrap gap-2">
        {items.map((c) => (
          <li key={c.address}>
            <Link href={`/token-check/${c.address}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-[14px] font-medium hover:border-ink">
              <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-semibold ${TONE[c.verdict]}`}>{c.verdict}</span>
              {c.symbol}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
