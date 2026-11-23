"use client";
import { useId, useState } from "react";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** What a Heimdall vault costs: 15% of new profit (10% manager, 5% Heimdall), 12.5% when the manager holds $HEIM. */
export function FeeCalc() {
  const [deposit, setDeposit] = useState("10000");
  const [ret, setRet] = useState("12");
  const [holder, setHolder] = useState(false);
  const id = useId();
  const d = Math.max(0, Number(deposit.replace(/,/g, "")) || 0);
  const r = Number(ret) || 0;
  const profit = d * (r / 100);
  const mgr = profit > 0 ? profit * 0.10 : 0;
  const hd = profit > 0 ? profit * (holder ? 0.025 : 0.05) : 0;
  const keep = profit - mgr - hd;
  const input = "w-full border border-ink bg-panel px-3 py-2.5 font-mono text-[15px] outline-none focus:shadow-[3px_3px_0_var(--color-brand)]";
  return (
    <div className="grid border border-ink bg-panel shadow-[6px_6px_0_var(--color-ink)] md:grid-cols-2">
      <div className="flex flex-col gap-5 border-b border-ink p-6 md:border-b-0 md:border-r">
        <span className="label text-ink">Vault fee calculator · USDG</span>
        <label className="flex flex-col gap-1.5" htmlFor={`${id}-d`}><span className="label">Your deposit</span>
          <input id={`${id}-d`} inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} className={input} /></label>
        <label className="flex flex-col gap-1.5" htmlFor={`${id}-r`}><span className="label">Vault return over the period · {r}%</span>
          <input id={`${id}-r`} type="range" min={-20} max={60} step={1} value={ret} onChange={(e) => setRet(e.target.value)} className="accent-[var(--color-brand)]" /></label>
        <label className="flex items-center gap-3 text-[14px]">
          <input type="checkbox" checked={holder} onChange={(e) => setHolder(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />
          The manager holds $HEIM <span className="font-mono text-[12px] text-muted">(Heimdall&apos;s cut halves)</span>
        </label>
      </div>
      <div className="flex flex-col justify-between gap-3 p-6">
        <dl className="flex flex-col gap-3 font-mono text-[14px]">
          <div className="flex justify-between"><dt className="text-muted">Profit</dt><dd>{usd(profit)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Manager · 10%</dt><dd>−{usd(mgr)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Heimdall · {holder ? "2.5" : "5"}%</dt><dd>−{usd(hd)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Management or exit fee</dt><dd>$0.00</dd></div>
          <div className="mt-2 flex items-end justify-between border-t border-ink pt-4"><dt className="label text-ink">You keep</dt><dd className={`display text-[44px] ${keep < 0 ? "text-deny" : "text-ink"}`}>{usd(d + keep)}</dd></div>
        </dl>
        <p className="text-[11px] leading-relaxed text-muted">{profit <= 0 ? "No profit, no fee: fees are charged only above the vault's previous high." : "Fees are taken only on new profit above the vault's previous high, as newly minted shares."}</p>
      </div>
    </div>
  );
}
