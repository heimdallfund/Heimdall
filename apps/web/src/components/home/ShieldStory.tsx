"use client";
import { useEffect, useRef, useState } from "react";
import { useScrollProgress } from "../motion/useScrollProgress";
import { VerdictBadge } from "../Verdict";
import { Icon } from "../Icons";

const seg = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const STEPS = [
  ["Your agent builds a transaction", "Any framework. It sends the intent to Shield before signing."],
  ["Shield simulates it", "Against the latest Robinhood Chain block: every asset that would move, every approval."],
  ["Unsafe? Denied.", "An unlimited approval to a plain wallet never reaches a signature."],
  ["Safe? Signed and executed.", "An EIP-712 receipt lets the vault execute, inside its onchain limits."],
];

/** Pinned scroll story: two transactions cross the bridge. One is denied, one goes through. */
export function ShieldStory() {
  const [ref, p] = useScrollProgress<HTMLDivElement>();
  const stageWrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = stageWrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / 1000)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // timeline
  const m1 = ease(seg(p, 0.06, 0.24)), scan1 = seg(p, 0.24, 0.36), deny = seg(p, 0.36, 0.42), fall = ease(seg(p, 0.46, 0.54));
  const m2 = ease(seg(p, 0.54, 0.68)), scan2 = seg(p, 0.68, 0.78), allow = seg(p, 0.78, 0.83), pass = ease(seg(p, 0.85, 0.96));
  const step = p < 0.22 ? 0 : p < 0.36 ? 1 : p < 0.54 ? 2 : p < 0.8 ? (p < 0.68 ? 0 : 1) : 3;
  const scanning = (scan1 > 0 && scan1 < 1) || (scan2 > 0 && scan2 < 1);
  const glowColor = deny > 0 && fall < 1 && p < 0.54 ? "rgba(180,35,24,.28)" : allow > 0 ? "rgba(11,122,59,.22)" : "rgba(51,85,255,.22)";
  const nav = 1 + 0.048 * pass;

  return (
    <section ref={ref} aria-labelledby="story" className="relative h-[340vh] border-y border-line bg-ice">
      <div className="sticky top-16 flex h-[calc(100vh-64px)] flex-col justify-center overflow-hidden py-6">
        <div className="mx-auto w-full max-w-[1240px] px-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
            <div>
              <span className="eyebrow">How it works</span>
              <h2 id="story" className="mt-2 text-[32px] font-bold tracking-[-0.025em] md:text-[40px]">Nothing crosses the bridge unchecked.</h2>
            </div>
            <ol className="flex gap-1.5" aria-hidden="true">{STEPS.map((_, i) => <li key={i} className={`h-1.5 w-10 rounded-full transition-colors ${i <= step ? "bg-brand" : "bg-line-strong"}`} />)}</ol>
          </div>

          <div className="grid items-center gap-8 lg:grid-cols-[300px_1fr]">
            <ol className="hidden flex-col gap-3 lg:flex">
              {STEPS.map(([t, d], i) => (
                <li key={t} className={`rounded-xl border p-4 transition-all duration-300 ${i === step ? "border-brand/30 bg-panel shadow-[0_8px_24px_-14px_rgba(51,85,255,.5)]" : "border-transparent opacity-45"}`}>
                  <div className="text-[15px] font-semibold">{t}</div>
                  <div className="mt-1 text-[13.5px] leading-relaxed text-muted">{d}</div>
                </li>
              ))}
            </ol>
            <div className="lg:hidden"><div className="text-[17px] font-semibold">{STEPS[step][0]}</div><div className="mt-1 text-[14px] text-muted">{STEPS[step][1]}</div></div>

            <div ref={stageWrap} className="relative w-full" style={{ height: 440 * scale }}>
              <div className="absolute left-0 top-0 origin-top-left" style={{ width: 1000, height: 440, transform: `scale(${scale})` }}>
                {/* bridge line */}
                <div className="absolute left-[90px] right-[90px] top-[210px] h-[2px] bg-[repeating-linear-gradient(90deg,#C9D2F5_0_8px,transparent_8px_16px)]" />
                {/* agent */}
                <div className="absolute left-0 top-[140px] flex w-[150px] flex-col items-center gap-2">
                  <div className="card flex size-[140px] items-center justify-center"><svg viewBox="0 0 100 100" width="84" height="84" aria-hidden="true"><line x1="50" y1="8" x2="50" y2="24" stroke="#3355FF" strokeWidth="6" strokeLinecap="round" /><circle cx="50" cy="8" r="7" fill="#7C95FF" /><rect x="14" y="24" width="72" height="62" rx="20" fill="#3355FF" /><circle cx="37" cy="53" r="8" fill="#fff" /><circle cx="63" cy="53" r="8" fill="#fff" /><rect x="38" y="70" width="24" height="5" rx="2.5" fill="#A8BDFF" /></svg></div>
                  <span className="text-[13px] font-semibold text-muted">AI agent</span>
                </div>
                {/* shield */}
                <div className="absolute left-[410px] top-[100px] flex w-[180px] flex-col items-center gap-2">
                  <div className="relative flex size-[200px] items-center justify-center">
                    <div className="absolute inset-0 rounded-full transition-[background] duration-300" style={{ background: `radial-gradient(closest-side, ${glowColor}, transparent)`, transform: `scale(${scanning ? 1.15 : 1})` }} />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/brand-3d.webp" alt="" width={120} height={145} className="relative" style={{ transform: `rotate(${scanning ? Math.sin(p * 400) * 2 : 0}deg)` }} />
                  </div>
                  <span className="text-[13px] font-semibold text-muted">Heimdall Shield</span>
                </div>
                {/* vault */}
                <div className="absolute right-0 top-[120px] flex w-[190px] flex-col items-center gap-2" style={{ transform: `scale(${1 + 0.04 * Math.sin(Math.PI * pass)})` }}>
                  <div className="card w-[190px] p-4">
                    <div className="flex items-center justify-between"><span className="text-[14px] font-semibold">Vault</span><Icon name="vault" size={18} className="text-brand" /></div>
                    <div className="mt-2 font-mono text-[22px]">{nav.toFixed(4)}</div>
                    <div className="text-[11px] text-muted">USDG / share</div>
                    <div className="mt-3 flex h-2 overflow-hidden rounded-full"><span style={{ width: `${30 + 12 * pass}%`, background: "#76B900" }} /><span style={{ width: "30%", background: "#E31937" }} /><span className="flex-1 bg-brand" /></div>
                  </div>
                  <span className="text-[13px] font-semibold text-muted">Agent-run vault</span>
                </div>

                {/* tx 1: denied */}
                <div className="absolute top-[170px]" style={{ left: lerp(150, 200, m1), opacity: Math.min(1, m1 * 4) * (1 - fall), transform: `translateY(${fall * 160}px) rotate(${-10 * fall}deg) translateX(${deny > 0 && deny < 1 ? Math.sin(deny * 40) * 6 : 0}px)` }}>
                  <TxCard title="approve()" line="USDG · unlimited" sub="to 0x3333…3333" scan={scan1} />
                  <div className="absolute -top-12 left-1/2 -translate-x-1/2" style={{ opacity: deny, transform: `translateX(-50%) scale(${0.6 + 0.4 * deny})` }}><VerdictBadge kind="DENY" size="lg" /></div>
                </div>
                {/* tx 2: allowed */}
                <div className="absolute top-[170px]" style={{ left: lerp(lerp(150, 200, m2), 780, pass), opacity: Math.min(1, m2 * 4) * (1 - seg(p, 0.93, 0.98)), transform: `scale(${1 - 0.35 * pass})` }}>
                  <TxCard title="swap()" line="500 USDG → NVDA" sub="via vault.execute" scan={scan2} />
                  <div className="absolute -top-12 left-1/2" style={{ opacity: allow * (1 - pass), transform: `translateX(-50%) scale(${0.6 + 0.4 * allow})` }}><VerdictBadge kind="ALLOW" size="lg" /></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TxCard({ title, line, sub, scan }: { title: string; line: string; sub: string; scan: number }) {
  return (
    <div className="card relative w-[200px] overflow-hidden px-4 py-3 border-ink shadow-[4px_4px_0_var(--color-ink)]">
      <div className="font-mono text-[15px] font-semibold text-brand-600">{title}</div>
      <div className="mt-1 text-[13px]">{line}</div>
      <div className="font-mono text-[11.5px] text-muted">{sub}</div>
      {scan > 0 && scan < 1 && <div className="absolute inset-y-0 w-12 bg-gradient-to-r from-transparent via-brand/25 to-transparent" style={{ left: `${-20 + scan * 120}%` }} />}
    </div>
  );
}
