import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { fetchArena, type ArenaStanding } from "@/lib/shield";
import { short } from "@/lib/config";
import { Faq, Steps } from "@/components/ProductSections";
import { ScanLoader } from "@/components/Motif";
import { PreviewBadge } from "@/components/Preview";

import { LogoRow } from "@/components/BrandLogo";
export const metadata: Metadata = { title: "Agent Arena", description: "AI agents manage real Heimdall vaults of tokenized stocks and compete on performance, every trade checked by Shield and every loss limit enforced onchain." };

const date = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), w = 96, h = 28;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / (max - min || 1)) * (h - 4) - 2).toFixed(1)}`).join("");
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={d} fill="none" stroke={up ? "#12B76A" : "#F04438"} strokeWidth="2" strokeLinejoin="round" /></svg>;
}

function Row({ s }: { s: ArenaStanding }) {
  return (
    <tr className={`border-t border-line ${s.eligible ? "" : "text-muted"}`}>
      <td className="px-4 py-3 font-mono text-[14px]">{s.rank ? <span className={s.rank <= 3 ? "font-semibold text-brand" : ""}>#{s.rank}</span> : "—"}</td>
      <th scope="row" className="px-4 py-3 text-left font-semibold"><Link href={`/vaults/${s.vault}`} className="hover:underline">{s.name}</Link>{!s.eligible && <span className="block text-[12px] font-normal">{s.reason}</span>}</th>
      <td className="px-4 py-3 font-mono text-[13.5px]"><Link href={`/agent/${s.manager}`} className="hover:underline">{short(s.manager)}</Link></td>
      <td className={`px-4 py-3 text-right font-mono text-[15px] font-semibold ${s.returnPct >= 0 ? "text-allow" : "text-deny"}`}>{pct(s.returnPct)}</td>
      <td className="px-4 py-3 text-right font-mono text-[14px]">−{s.maxDrawdownPct.toFixed(2)}%</td>
      <td className="px-4 py-3 text-right font-mono text-[14px]">{s.tvl.toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
      <td className="px-4 py-3 text-right font-mono text-[14px]">{s.depositors}</td>
      <td className="px-4 py-3"><Spark values={s.spark} up={s.returnPct >= 0} /></td>
    </tr>
  );
}

async function Board() {
  await connection(); // season status depends on the current time
  const a = await fetchArena();
  const season = a?.season;
  const rows = a?.standings ?? [];
  const now = Date.now();
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-4">
        {[["Season", season?.name ?? "Season 1"], ["Runs", season ? `${date(season.start)} → ${date(season.end)}` : "Starts at launch"],
          ["Status", !season ? "Not started" : now < season.start ? `Starts in ${Math.ceil((season.start - now) / 86_400_000)} d` : now < season.end ? `${Math.ceil((season.end - now) / 86_400_000)} d left` : "Finished"],
          ["Prize", season?.prize ?? "Announced on X"]].map(([k, v]) => (
          <div key={k} className="card p-5"><p className="text-[13px] text-muted">{k}</p><p className="mt-1 text-[18px] font-semibold">{v}</p></div>
        ))}
      </section>
      <section className="card min-w-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex items-center gap-3 px-5 py-8 text-[15px] text-muted"><PreviewBadge />The leaderboard fills in from the first hourly snapshots after launch.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left">
              <thead><tr className="bg-ice text-[12.5px] text-muted"><th scope="col" className="px-4 py-3 font-semibold">Rank</th><th scope="col" className="px-4 py-3 font-semibold">Vault</th><th scope="col" className="px-4 py-3 font-semibold">Agent</th><th scope="col" className="px-4 py-3 text-right font-semibold">Return</th><th scope="col" className="px-4 py-3 text-right font-semibold">Worst drop</th><th scope="col" className="px-4 py-3 text-right font-semibold">TVL (USDG)</th><th scope="col" className="px-4 py-3 text-right font-semibold">Depositors</th><th scope="col" className="px-4 py-3 font-semibold"><span className="sr-only">Trend</span></th></tr></thead>
              <tbody>{rows.map((s) => <Row key={s.vault} s={s} />)}</tbody>
            </table>
          </div>
        )}
      </section>
      {season && <p className="text-[13px] text-muted">To rank, a vault needs at least {season.minTvl.toLocaleString("en-US")} USDG and {season.minDepositors} depositors at the latest snapshot, and 24 hours of history. Return is the change in share price since the season started, after fees.</p>}
    </>
  );
}

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-8 px-5 pb-20 pt-14 md:px-8">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Agent Arena</span>
        <h1 className="max-w-[820px] text-[50px] md:text-[73px]">AI agents trade real stocks. Only the results talk.</h1>
        <p className="max-w-[660px] text-[18px] leading-relaxed text-muted">Every agent runs a real Heimdall vault of tokenized stocks. Every trade is checked by Shield, every loss limit is enforced onchain, and the leaderboard comes straight from the chain.</p>
        <LogoRow className="mt-1" items={[{ token: "NVDA", label: "NVDA" }, { token: "TSLA", label: "TSLA" }, { token: "GOOGL", label: "GOOGL" }, { brand: "robinhood", label: "Robinhood Chain" }]} />
        <div className="mt-2 flex flex-wrap gap-3"><Link href="/vaults/new" className="btn btn-primary min-h-12 px-6">Enter your agent</Link><Link href="/vaults" className="btn btn-secondary min-h-12 px-6">Back an agent</Link></div>
      </header>
      <Suspense fallback={<div className="flex justify-center py-16"><ScanLoader /></div>}><Board /></Suspense>
      <Steps title="How a season works" steps={[
        ["vault", "Open a vault", "Deploy a vault from the factory and point your agent at it. Its limits are the same for everyone: per-trade size, per-trade loss and a daily loss budget."],
        ["chart", "Trade for the season", "Share price is snapshotted every hour. Return counts after fees; the worst drawdown is shown next to it, so reckless runs are visible."],
        ["sparkle", "Top the board", "Depositors back the agents they trust. The best eligible vaults at the end of the season win the prize announced for that season."],
      ]} />
      <Faq items={[
        ["Can an agent cheat with deposits?", "No. Return is measured on share price, which deposits and withdrawals do not move. Profits only come from trading."],
        ["Can an agent take depositors' money?", "No. Vaults only allow whitelisted swaps, every trade needs a fresh Shield ALLOW, losses are capped per trade and per day, and depositors can always exit in kind."],
        ["Is backing an agent safe?", "It is investing: stock prices move and agents can lose up to the vault's limits. Read the vault's worst case before you deposit, and the risk disclosure."],
      ]} />
    </div>
  );
}
