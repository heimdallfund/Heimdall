import type { Metadata } from "next";
import { explorerAddress } from "@/lib/config";
import { Suspense } from "react";
import { connection } from "next/server";
import { Icon } from "@/components/Icons";
import { readHeimSupply } from "@/lib/heimSupply";
import { heimAddress } from "@/lib/heim";

import { LogoRow } from "@/components/BrandLogo";
export const metadata: Metadata = { title: "$HEIM", description: "The Heimdall token: holding it makes the guardian cheaper to use." };

const rows: [string, string, string][] = [
  ["Free Shield checks per wallet", "1,000 / day", "5,000 / day"],
  ["Signals split for providers", "90 / 10", "95 / 5"],
  ["Vault fee paid by depositors", "15% of profit", "12.5% of profit"],
  ["Share of protocol fees", "—", "Stake to earn USDG"],
  ["Leaderboard", "Standard listing", "Guardian badge"],
];

const FEES: [string, string, string][] = [
  ["Heimdall Pay", "1% of every released job", "Agents paying agents"],
  ["Vaults", "5% of profit above the high-water mark", "2.5% when the manager holds $HEIM"],
  ["Signals", "10% of what providers redeem", "5% when the provider holds $HEIM"],
  ["Auto-Invest", "0.25% of every buy", "Fixed for each plan's life"],
];

async function HeimCA() {
  await connection();
  const a = await heimAddress();
  return <p className="mt-2 break-all font-mono text-[15px]">{a ? <a className="hover:text-brand" href={explorerAddress(a)}>{a}</a> : "Appears here automatically at launch."}</p>;
}

async function Supply() {
  await connection();
  const s = await readHeimSupply().catch(() => null);
  const n = (v: string) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const cells: [string, string][] = s
    ? [["Total supply", n(s.total)], ["Circulating", n(s.circulating)], ["Staked", s.staked === null ? "—" : n(s.staked)], ["Burned", n(s.burned)]]
    : [["Total supply", "At launch"], ["Circulating", "At launch"], ["Staked", "At launch"], ["Burned", "At launch"]];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
      {cells.map(([k, v]) => <div key={k} className="bg-panel p-5"><dt className="text-[13px] text-muted">{k}</dt><dd className="mt-1.5 font-mono text-[20px]">{v}</dd></div>)}
    </dl>
  );
}

export default function TokenPage() {
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-14 px-6 pb-24 pt-16">
      <header className="flex flex-col items-center gap-4 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand-3d.webp" alt="" width={84} height={102} className="float-3d" />
        <span className="eyebrow">Token</span>
        <h1 className="text-[55px] md:text-[73px]">$HEIM</h1>
        <p className="max-w-[560px] text-[18px] leading-relaxed text-muted">The Heimdall token. Hold it and the guardian is cheaper to use. Stake it and you earn a share of protocol fees, paid in USDG. No lock-up.</p>
        <LogoRow className="mt-1" items={[{ token: "HEIM", label: "$HEIM" }, { token: "USDG", label: "Fees in USDG" }, { brand: "robinhood", label: "Robinhood Chain" }]} />
      </header>

      <section className="card p-6">
        <h2 className="text-[13px] font-semibold text-muted">Contract address · Robinhood Chain</h2>
        <Suspense fallback={<p className="mt-2 font-mono text-[15px] text-muted">…</p>}><HeimCA /></Suspense>
      </section>

      <section aria-labelledby="benefits" className="flex flex-col gap-6">
        <div className="text-center"><span className="eyebrow">Holder benefits</span><h2 id="benefits" className="display mt-2 text-[46px]">What holding changes</h2></div>
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[560px] border-collapse text-left text-[15px]">
            <thead><tr className="bg-ice text-[13px]"><th scope="col" className="px-6 py-4 font-semibold"><span className="sr-only">Feature</span></th><th className="px-6 py-4 font-semibold text-muted">Without $HEIM</th><th className="px-6 py-4 font-semibold text-brand">Holding 5,000,000 $HEIM</th></tr></thead>
            <tbody>{rows.map(([k, a, b]) => (
              <tr key={k} className="border-t border-line">
                <th scope="row" className="px-6 py-4 text-left font-medium">{k}</th>
                <td className="px-6 py-4 font-mono text-[14px] text-muted">{a}</td>
                <td className="px-6 py-4"><span className="inline-flex items-center gap-2 font-mono text-[14px] font-medium"><span className="inline-flex size-5 items-center justify-center rounded-full bg-allow-soft text-allow"><Icon name="check" size={13} /></span>{b}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="text-center text-[14px] text-muted">The balance is checked onchain, in the wallet that uses the benefit, at the moment it applies. Staked $HEIM counts too.</p>
      </section>

      <section aria-labelledby="value" className="flex flex-col gap-6">
        <div className="text-center"><span className="eyebrow">Real yield</span><h2 id="value" className="display mt-2 text-[46px]">Where staking rewards come from</h2>
          <p className="mx-auto mt-3 max-w-[600px] leading-relaxed text-muted">No emissions. Every reward is a fee someone paid in USDG: vaults, Signals, Pay, Auto-Invest and the Shield API all pay into one fee splitter. Once a day the fee splitter sends 50% to $HEIM stakers (the contract caps it at 80%) and the rest to the treasury.</p></div>
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[560px] border-collapse text-left text-[15px]">
            <thead><tr className="bg-ice text-[13px]"><th scope="col" className="px-6 py-4 font-semibold">Product</th><th scope="col" className="px-6 py-4 font-semibold">Fee</th><th scope="col" className="px-6 py-4 font-semibold text-muted">Note</th></tr></thead>
            <tbody>{FEES.map(([p, f, note]) => (
              <tr key={p} className="border-t border-line"><th scope="row" className="px-6 py-4 text-left font-medium">{p}</th><td className="px-6 py-4 font-mono text-[14px]">{f}</td><td className="px-6 py-4 text-[14px] text-muted">{note}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="supply" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3"><h2 id="supply" className="display text-[35px]">Supply</h2>
          <p className="text-[13px] text-muted">Live from Robinhood Chain · API: <a className="font-mono text-brand hover:underline" href="/api/heim/supply">/api/heim/supply</a></p></div>
        <Suspense fallback={<div className="h-[94px] animate-pulse rounded-xl border border-line bg-ice" />}><Supply /></Suspense>
      </section>

      <p className="text-center text-[13px] text-muted">$HEIM is a utility token, not an investment or a share of any company. Nothing here is financial advice.</p>
    </div>
  );
}
