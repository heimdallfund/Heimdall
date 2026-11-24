import type { Metadata } from "next";
import { CtaBand, Faq, Steps } from "@/components/ProductSections";
import Link from "next/link";
import { Suspense } from "react";
import { getVaults } from "@/lib/reads";
import { short } from "@/lib/config";
import { NavSpark, VaultVisual } from "@/components/Visuals";
import { LaunchBanner, PreviewBadge, AuditNotice } from "@/components/Preview";

import { LogoRow } from "@/components/BrandLogo";
export const metadata: Metadata = { title: "Vaults — agent-run stock vaults" };

const pct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const usd = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));

async function VaultList() {
  const vaults = await getVaults();
  if (!vaults.length) {
    const preview = [
      ["Guardian Balanced", "hGRD", "Heimdall reference agent", "Rebalances a stock basket with token-risk and premium signals.", 20, 2],
      ["Your strategy", "hYOU", "Any manager agent", "Open a vault, set your limits and trade through Shield.", 25, 3],
    ] as const;
    return (
      <div className="flex flex-col gap-5">
        <AuditNotice cap="Deposits are capped at 10,000 USDG per vault while it runs." />
        <LaunchBanner>Vaults open with the mainnet launch, each with a 10,000 USDG deposit cap to start. Heimdall&apos;s reference agent opens the first one.</LaunchBanner>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-5">
          {preview.map(([name, sym, who, desc, trade, loss]) => (
            <div key={name} className="card flex flex-col gap-4 p-6">
              <div className="flex items-center justify-between"><div className="flex gap-2"><span className="rounded-md bg-allow-soft px-2 py-1 text-xs font-semibold text-allow">Shield-guarded</span><span className="rounded-md bg-[#EEF2F7] px-2 py-1 text-xs font-semibold text-[#3A4560]">{sym}</span></div><PreviewBadge /></div>
              <div><h2 className="text-xl font-semibold">{name}</h2><p className="mt-1 text-sm text-muted">{who} · {desc}</p></div>
              <NavSpark className="h-14 w-full" />
              <div className="grid grid-cols-3 gap-2 border-t border-line pt-4">
                <div><div className="text-xs text-muted">Deposit cap</div><div className="mt-1 font-mono">10,000</div></div>
                <div><div className="text-xs text-muted">Max / trade</div><div className="mt-1 font-mono">{trade}%</div></div>
                <div><div className="text-xs text-muted">Max loss / trade</div><div className="mt-1 font-mono">{loss}%</div></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-5">
      {vaults.map((v) => (
        <Link key={v.address} href={`/vaults/${v.address}`} className="card card-hover flex flex-col gap-4 p-6">
          <div className="flex flex-wrap gap-2"><span className="rounded-md bg-allow-soft px-2 py-1 text-xs font-semibold text-allow">Shield-guarded</span><span className="rounded-md bg-[#EEF2F7] px-2 py-1 text-xs font-semibold text-[#3A4560]">{v.symbol}</span></div>
          <h2 className="font-display text-xl font-semibold">{v.name}</h2>
          <div className="grid grid-cols-3 gap-2 border-t border-line pt-4">
            <div><div className="text-xs text-muted">NAV (USDG)</div><div className="mt-1 font-mono">{usd(v.nav)}</div></div>
            <div><div className="text-xs text-muted">Since start</div><div className={`mt-1 font-mono ${v.returnPct !== null && v.returnPct < 0 ? "text-deny" : "text-allow"}`}>{pct(v.returnPct)}</div></div>
            <div><div className="text-xs text-muted">Max / trade</div><div className="mt-1 font-mono">{v.maxTradePct}%</div></div>
          </div>
          <span className="text-sm text-muted">Manager <span className="font-mono">{short(v.manager)}</span></span>
        </Link>
      ))}
    </div>
  );
}

export default function VaultsPage() {
  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-8 px-6 pb-16 pt-10">
      <div className="flex flex-wrap items-center gap-12 pb-6 pt-6">
        <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-4">
          <span className="eyebrow">For depositors · Vaults</span>
          <h1 className="text-[55px]">Stock vaults run by agents, guarded by Shield</h1>
          <p className="text-lg leading-relaxed text-muted">Deposit USDG and get vault shares. The manager agent can only trade with a fresh Shield receipt, inside onchain size and loss limits, and can never withdraw your funds. You can always exit in kind.</p>
          <LogoRow className="mt-1" items={[{ token: "USDG", label: "Deposit USDG" }, { token: "NVDA", label: "NVDA" }, { token: "TSLA", label: "TSLA" }, { token: "AAPL", label: "AAPL" }, { token: "META", label: "+13 stocks" }, { brand: "uniswap", label: "Uniswap" }, { brand: "chainlink", label: "Chainlink" }]} />
          <div className="flex flex-wrap gap-3"><Link href="/vaults/new" className="btn btn-primary">Open a vault</Link><Link href="/docs/vaults" className="btn btn-secondary">How vaults work</Link></div>
        </div>
        <div className="flex min-w-0 flex-[1_1_420px] justify-center"><VaultVisual /></div>
      </div>
      <Suspense fallback={<p className="text-muted">Loading vaults from Robinhood Chain…</p>}><VaultList /></Suspense>

      <Steps title="Your deposit, their strategy, contract rules" steps={[
        ["coins", "Deposit USDG", "Receive vault shares priced at NAV. Each vault starts with a 10,000 USDG cap while it builds a record."],
        ["shield", "The agent trades", "Every trade needs a fresh Shield receipt and passes onchain size, per-trade and daily loss limits."],
        ["exit", "Exit any time", "Withdraw USDG, or redeem in kind for your slice of every asset, even while the vault is paused."],
      ]} />
      <Faq items={[
        ["Can the manager withdraw my funds?", "No. The manager can only call reviewed swap functions through Shield. Transfers out of the vault are impossible."],
        ["What are the fees?", "15% of new profit above the high-water mark (12.5% if the manager holds $HEIM). No management or withdrawal fee."],
        ["What if a price feed fails?", "Deposits, withdrawals and trades that need prices pause, but in-kind exits keep working, and the multisig can replace the feed."],
      ]} />
      <CtaBand title="Run a strategy people can trust" text="Open a vault, connect your agent through Shield, and let the onchain record speak." primary={["/vaults/new", "Open a vault"]} secondary={["/docs/vaults", "How vaults work"]} />
    </div>
  );
}
