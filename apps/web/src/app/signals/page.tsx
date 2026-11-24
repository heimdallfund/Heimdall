import type { Metadata } from "next";
import { CtaBand, Faq, Steps } from "@/components/ProductSections";
import Link from "next/link";
import { Suspense } from "react";
import { getSignals } from "@/lib/reads";
import { explorerAddress, short } from "@/lib/config";
import { SignalsVisual } from "@/components/Visuals";
import { LaunchBanner, PreviewBadge, AuditNotice } from "@/components/Preview";

import { LogoRow } from "@/components/BrandLogo";
export const metadata: Metadata = { title: "Signals — pay-per-call market signals" };

const catStyle: Record<string, string> = {
  stocks: "bg-[#E3F7F4] text-teal-ink", onchain: "bg-violet-soft text-violet-ink", risk: "bg-[#FFF1DE] text-[#A44B00]",
  sentiment: "bg-[#FBEAFB] text-[#8A2C8F]", crypto: "bg-[#EEF2F7] text-[#3A4560]",
};

async function SignalGrid() {
  const signals = await getSignals();
  if (!signals.length) {
    const preview = [
      ["risk", "Token Risk", "Contract checks, upgradeable proxies, owner powers (mint, pause, blacklist, fees) and blocklists, scored 0–100.", "0.02", "/v1/token-risk?token=0x…"],
      ["onchain", "Address Intel", "Wallet, contract or EIP-7702 delegate? Activity, ETH and USDG balance, and blocklist status.", "0.01", "/v1/address-intel?address=0x…"],
      ["stocks", "Stock Premium", "Onchain stock token price against the exchange price, as a premium in basis points.", "0.05", "/v1/stock-premium?symbol=NVDA"],
    ];
    return (
      <div className="flex flex-col gap-5">
        <AuditNotice />
        <LaunchBanner>Signals open with the mainnet launch. These are the official Heimdall signals that will be listed first; third-party providers can list theirs from day one.</LaunchBanner>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-5">
          {preview.map(([cat, name, desc, price, ep]) => (
            <article key={name} className="card flex flex-col gap-3.5 p-[22px]">
              <div className="flex items-center justify-between">
                <span className={`rounded-md px-2 py-1 text-xs font-semibold ${catStyle[cat]}`}>{cat}</span>
                <PreviewBadge />
              </div>
              <h2 className="text-[19px] font-semibold">{name}</h2>
              <p className="text-sm leading-relaxed text-muted">{desc}</p>
              <div className="mt-auto flex items-end justify-between border-t border-line pt-3.5">
                <div><div className="text-xs text-muted">Price / call</div><div className="mt-1 font-mono text-[15px]">{price} USDG</div></div>
                <div className="text-right"><div className="text-xs text-muted">Provider</div><div className="mt-1 text-[15px] font-medium">Heimdall</div></div>
              </div>
              <code className="truncate rounded-lg border border-line bg-ice px-3 py-2 font-mono text-xs text-[#3A4560]">{ep}</code>
            </article>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-5">
      {signals.map((s) => (
        <article key={s.id} className="card card-hover flex flex-col gap-3.5 p-[22px]">
          <div className="flex items-center justify-between">
            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${catStyle[s.meta.category ?? ""] ?? catStyle.crypto}`}>{s.meta.category ?? "signal"}</span>
            <a href={explorerAddress(s.provider)} className="font-mono text-xs text-muted hover:text-violet-ink">{short(s.provider)}</a>
          </div>
          <h2 className="text-[19px] font-semibold">{s.meta.name ?? `Signal #${s.id}`}{!s.active && <span className="ml-2 text-sm font-normal text-muted">(paused)</span>}</h2>
          {s.meta.description && <p className="text-sm leading-relaxed text-muted">{s.meta.description}</p>}
          <div className="mt-auto flex items-end justify-between border-t border-line pt-3.5">
            <div><div className="text-xs text-muted">Price / call</div><div className="mt-1 font-mono text-[15px]">{s.price} USDG</div></div>
            <div className="text-right"><div className="text-xs text-muted">Signal ID</div><div className="mt-1 font-mono text-[15px]">#{s.id}</div></div>
          </div>
          {s.meta.endpoint && <code className="truncate rounded-lg border border-line bg-ice px-3 py-2 font-mono text-xs text-[#3A4560]">{s.meta.endpoint}</code>}
        </article>
      ))}
    </div>
  );
}

export default function SignalsPage() {
  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-8 px-6 pb-16 pt-10">
      <div className="flex flex-wrap items-center gap-12 pb-6 pt-6">
        <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-4">
          <span className="eyebrow">For signal providers · Signals</span>
          <h1 className="text-[55px]">Signals your agent can buy per call</h1>
          <p className="text-lg leading-relaxed text-muted">Pay in USDG for each answer: directly onchain, or with a gasless voucher your agent signs per call. No subscriptions. 90% goes to the provider.</p>
          <LogoRow className="mt-1" items={[{ token: "USDG", label: "Paid in USDG" }, { brand: "robinhood", label: "Robinhood Chain" }]} />
          <div className="flex flex-wrap gap-3"><Link href="/signals/new" className="btn btn-primary">Sell a signal</Link><Link href="/docs/signals" className="btn btn-secondary">How payment works</Link></div>
        </div>
        <div className="flex min-w-0 flex-[1_1_420px] justify-center"><SignalsVisual /></div>
      </div>
      <Suspense fallback={<p className="text-muted">Loading signals from Robinhood Chain…</p>}><SignalGrid /></Suspense>

      <Steps title="Pay per answer, not per month" steps={[
        ["coins", "Fund once", "Approve and fund a USDG balance in HeimdallSignals. Withdraw it any time after a 24-hour delay."],
        ["receipt", "Sign a voucher per call", "Each request carries a cumulative EIP-712 voucher in a header. No gas, no transaction."],
        ["check", "Provider redeems", "Providers redeem the latest voucher whenever they like and keep 90% of every call."],
      ]} />
      <Faq items={[
        ["Why vouchers instead of paying every call onchain?", "A voucher is a signature, so a call costs no gas and adds no latency. Providers settle many calls in one redeem."],
        ["Can a provider overcharge me?", "No. Vouchers state the total you agreed to pay, and direct payments carry a maxPricePerCall so a price change cannot surprise you."],
        ["Who can sell signals?", "Anyone. Register an endpoint, a price and a payout address, then put the SDK's voucher gate in front of your API."],
      ]} />
      <CtaBand title="Sell what your agent knows" text="List a signal in one transaction and get paid per call in USDG." primary={["/signals/new", "List a signal"]} secondary={["/docs/signals", "Provider guide"]} />
    </div>
  );
}
