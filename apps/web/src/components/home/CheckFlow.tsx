"use client";
import { useEffect, useRef, useState } from "react";

type Line = { who: "AGENT" | "SHIELD" | "RESULT"; text: string; tone?: "deny" | "allow" | "muted" };
const SCENARIOS: Record<string, { label: string; lines: Line[] }> = {
  drainer: {
    label: "Drainer approval",
    lines: [
      { who: "AGENT", text: "POST /v1/check\napprove(0x3f…a91, unlimited) on USDG" },
      { who: "SHIELD", text: "simulating on the latest block…", tone: "muted" },
      { who: "SHIELD", text: "0x3f…a91 is a plain wallet, not a contract\nunlimited USDG allowance · 2,500 USDG exposed" },
      { who: "RESULT", text: '200 OK\n{ "verdict": "DENY", "riskScore": 96,\n  "findings": ["APPROVE_ON_EOA", "UNLIMITED_APPROVAL"] }', tone: "deny" },
      { who: "AGENT", text: "does not sign · webhook shield.deny → your server", tone: "muted" },
    ],
  },
  swap: {
    label: "Stock swap",
    lines: [
      { who: "AGENT", text: "POST /v1/check\nexactInputSingle · 2,500 USDG → NVDA" },
      { who: "SHIELD", text: "simulating on the latest block…", tone: "muted" },
      { who: "SHIELD", text: "−2,500 USDG · +13.71 NVDA\nUniswap router recognised · price within Chainlink bound" },
      { who: "RESULT", text: '200 OK\n{ "verdict": "ALLOW",\n  "receipt": { "expiresAt": "+120 s", "signature": "0x8c…" } }', tone: "allow" },
      { who: "AGENT", text: "vault.execute(receipt) → trade settles onchain", tone: "muted" },
    ],
  },
  permit: {
    label: "Permit2 signature",
    lines: [
      { who: "AGENT", text: "POST /v1/check-signature\nPermitBatch · every token · expires 2099" },
      { who: "SHIELD", text: "decoding EIP-712 typed data…", tone: "muted" },
      { who: "SHIELD", text: "spender 0x77…e01 is on the Heimdall blocklist\nunlimited amounts, 73-year expiry" },
      { who: "RESULT", text: '200 OK\n{ "verdict": "DENY",\n  "findings": ["BLOCKLISTED_SPENDER", "PERMIT_UNLIMITED"] }', tone: "deny" },
      { who: "AGENT", text: "refuses to sign · nothing leaves the wallet", tone: "muted" },
    ],
  },
};

/** "One check, start to finish": a request/response walkthrough that plays line by line when it scrolls into view. */
export function CheckFlow() {
  const [key, setKey] = useState<keyof typeof SCENARIOS>("drainer");
  const [shown, setShown] = useState(0);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const lines = SCENARIOS[key]!.lines;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setVisible(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setVisible(true); io.disconnect(); } }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(lines.length); return; }
    setShown(0);
    let i = 0;
    const t = setInterval(() => { i++; setShown(i); if (i >= lines.length) clearInterval(t); }, 650);
    return () => clearInterval(t);
  }, [key, visible, lines.length]);

  return (
    <div ref={ref} className="border border-ink bg-panel shadow-[6px_6px_0_var(--color-ink)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink px-4 py-2.5">
        <span className="label text-ink">One check, start to finish</span>
        <div role="tablist" aria-label="Example" className="flex flex-wrap gap-1">
          {Object.entries(SCENARIOS).map(([k, s]) => (
            <button key={k} role="tab" aria-selected={key === k} type="button" onClick={() => setKey(k as keyof typeof SCENARIOS)}
              className={`px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] ${key === k ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}>{s.label}</button>
          ))}
        </div>
      </div>
      <ol className="min-h-[360px] divide-y divide-line font-mono text-[12.5px] leading-relaxed" aria-live="polite">
        {lines.map((l, i) => (
          <li key={`${key}-${i}`} className={`grid grid-cols-[64px_1fr] gap-3 px-4 py-3 transition-opacity duration-300 sm:grid-cols-[76px_1fr] ${i < shown ? "opacity-100" : "opacity-0"}`}>
            <span className={`text-[10.5px] font-bold tracking-[0.1em] ${l.who === "SHIELD" ? "text-brand" : l.who === "RESULT" ? "text-ink" : "text-muted"}`}>{l.who}</span>
            <pre className={`whitespace-pre-wrap break-words font-mono ${l.tone === "deny" ? "text-deny" : l.tone === "allow" ? "text-allow" : l.tone === "muted" ? "text-muted" : "text-ink"}`}>{l.text}</pre>
          </li>
        ))}
      </ol>
      <p className="border-t border-line px-4 py-2 font-mono text-[10.5px] text-muted">Example responses, trimmed. The real API returns every finding with a plain-English reason.</p>
    </div>
  );
}
