import { VerdictBadge } from "./Verdict";
import { Icon } from "./Icons";

/** Illustrative product visuals (static, labelled as examples where they show numbers). */

export function ShieldVisual() {
  const findings = [
    ["deny", "Unlimited USDG approval to a wallet with no code"],
    ["warn", "Moves 100% of the agent's USDG balance"],
    ["info", "Target is a plain wallet (EOA)"],
  ] as const;
  const dot = { deny: "bg-deny", warn: "bg-[#D99A00]", info: "bg-[#9AA3B5]" };
  return (
    <div className="card w-full max-w-[520px] overflow-hidden border-ink shadow-[6px_6px_0_var(--color-ink)]">
      <div className="flex items-center justify-between border-b border-line bg-ice px-5 py-3">
        <span className="font-mono text-[12px] text-muted">POST /v1/check · 184 ms</span>
        <span className="rounded-sm bg-panel px-2 py-0.5 text-[11px] font-medium text-muted ring-1 ring-line">Example</span>
      </div>
      <div className="flex flex-col gap-5 p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13px] text-muted">approve(address,uint256) on USDG</div>
            <div className="mt-1 truncate font-mono text-[14px]">spender 0x3333…3333 · amount ∞</div>
          </div>
          <VerdictBadge kind="DENY" size="lg" />
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-[12px] text-muted"><span>Risk score</span><span className="font-mono text-ink">90 / 100</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-2"><div className="h-full w-[90%] rounded-full bg-gradient-to-r from-[#F5A524] to-deny" /></div>
        </div>
        <ul className="flex flex-col gap-2.5">
          {findings.map(([s, t]) => <li key={t} className="flex items-start gap-2.5 text-[14px]"><span className={`mt-[7px] size-2 shrink-0 rounded-full ${dot[s]}`} />{t}</li>)}
        </ul>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-ice px-3 py-2 font-mono text-[12px] text-muted">
          <Icon name="receipt" size={16} className="text-brand" /> EIP-712 receipt · signed · expires in 120 s
        </div>
      </div>
    </div>
  );
}

export function SignalsVisual() {
  const steps: [string, string, string, string][] = [
    ["Agent", "GET /v1/token-risk?token=0x9b1f…", "", "bg-panel"],
    ["Provider", "402 Payment Required", "price 0.02 USDG · pay with a voucher", "bg-warn-soft"],
    ["Agent", "x-heimdall-voucher: 0x5af0…", "signed offchain, no gas", "bg-panel"],
    ["Provider", "200 OK", "{ score: 12, level: \"low\" }", "bg-allow-soft"],
  ];
  return (
    <div className="card w-full max-w-[520px] p-5 border-ink shadow-[6px_6px_0_var(--color-ink)]">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[13px] font-semibold">One paid call</span>
        <span className="rounded-sm bg-ice px-2 py-0.5 text-[11px] font-medium text-muted ring-1 ring-line">Example</span>
      </div>
      <ol className="flex flex-col gap-2.5">
        {steps.map(([who, title, sub, bg], i) => (
          <li key={i} className={`flex ${who === "Agent" ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[85%] rounded-xl border border-line ${bg} px-4 py-2.5`}>
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{who}</div>
              <div className="font-mono text-[13px] text-ink">{title}</div>
              {sub && <div className="mt-0.5 font-mono text-[12px] text-muted">{sub}</div>}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex justify-between border-t border-line pt-3 text-[12px] text-muted"><span>Provider keeps 90%</span><span>Settled in USDG on Robinhood Chain</span></div>
    </div>
  );
}

export function NavSpark({ className = "", up = true }: { className?: string; up?: boolean }) {
  const d = up ? "M0 46 L20 44 L40 47 L60 40 L80 42 L100 34 L120 36 L140 27 L160 29 L180 20 L200 14" : "M0 20 L40 24 L80 22 L120 30 L160 28 L200 34";
  return (
    <svg viewBox="0 0 200 56" preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs><linearGradient id="nsg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#3355FF" stopOpacity=".18" /><stop offset="1" stopColor="#3355FF" stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L200 56 L0 56 Z`} fill="url(#nsg)" />
      <path d={d} fill="none" stroke="#3355FF" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function VaultVisual() {
  const holdings = [["NVDA", 30, "#76B900"], ["TSLA", 30, "#E31937"], ["USDG", 40, "#3355FF"]] as const;
  const limits = [["Per trade", 25, "25% of NAV"], ["Loss / trade", 30, "3%"], ["Loss / day", 50, "5%"]] as const;
  return (
    <div className="card w-full max-w-[520px] overflow-hidden border-ink shadow-[6px_6px_0_var(--color-ink)]">
      <div className="flex items-start justify-between p-5 pb-0">
        <div>
          <div className="text-[13px] text-muted">Guardian Balanced · hGRD</div>
          <div className="mt-1 font-mono text-[26px] font-medium">1.0482 <span className="text-[15px] text-muted">USDG / share</span></div>
        </div>
        <span className="rounded-sm bg-ice px-2 py-0.5 text-[11px] font-medium text-muted ring-1 ring-line">Example</span>
      </div>
      <NavSpark className="mt-2 h-24 w-full" />
      <div className="flex flex-col gap-4 border-t border-line p-5">
        <div>
          <div className="mb-2 text-[12px] text-muted">Holdings</div>
          <div className="flex h-2.5 overflow-hidden rounded-full">{holdings.map(([s, w, c]) => <span key={s} style={{ width: `${w}%`, background: c }} />)}</div>
          <div className="mt-2 flex gap-4 text-[12px]">{holdings.map(([s, w, c]) => <span key={s} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: c }} />{s} <span className="font-mono text-muted">{w}%</span></span>)}</div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {limits.map(([l, fill, v]) => (
            <div key={l} className="rounded-lg border border-line p-2.5">
              <div className="text-[11px] text-muted">{l}</div>
              <div className="mt-1 font-mono text-[13px]">≤ {v}</div>
              <div className="mt-2 h-1 rounded-full bg-ink-2"><div className="h-full rounded-full bg-brand" style={{ width: `${fill}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
