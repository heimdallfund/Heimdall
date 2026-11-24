import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { ScanLoader } from "@/components/Motif";
import { explorerAddress, short } from "@/lib/config";
import { fetchTokenCheck, legState, VERDICT_HEAD, type Leg, type TokenReport } from "@/lib/tokencheck";
import { TokenCheckForm } from "../TokenCheckForm";
import { WatchButton } from "@/components/WatchButton";
import { TokenCheckShare } from "../TokenCheckShare";
import { TokenAiSummary } from "../TokenAiSummary";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  return { title: `Token Check · ${isAddress(address) ? short(address) : "invalid"}`, description: "Simulated buy, sell and transfer of this Robinhood Chain token on its launchpad curve or Uniswap pool, with honeypot, tax, clawback, fake-ticker, dev and holder checks.", robots: { index: false } };
}

export default function Page({ params }: { params: Promise<{ address: string }> }) {
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-5 pb-16 pt-12 md:px-8">
      <Link href="/token-check" className="text-[14px] font-medium text-brand hover:underline">← Token Check</Link>
      <Suspense fallback={<div className="flex justify-center py-24"><ScanLoader label="Buying and selling it in a simulation…" /></div>}><Content params={params} /></Suspense>
    </div>
  );
}

const TONE = { ALLOW: ["border-allow/50 bg-allow-soft", "text-allow", VERDICT_HEAD.ALLOW], WARN: ["border-warn/50 bg-warn-soft", "text-warn", VERDICT_HEAD.WARN], DENY: ["border-deny/50 bg-deny-soft", "text-deny", VERDICT_HEAD.DENY] } as const;
const SEV = { deny: "bg-deny", warn: "bg-warn", info: "bg-line-strong" } as const;

function LegCard({ title, leg, good, extra }: { title: string; leg: Leg; good: string; extra?: string }) {
  const state = legState(leg);
  const dot = { ok: "bg-allow", warn: "bg-warn", bad: "bg-deny", skip: "bg-line-strong" }[state];
  const text = leg === null ? "Not simulated" : !leg.ok ? `Fails${leg.reason ? `: ${leg.reason}` : ""}` : leg.taxPct ? `${leg.taxPct.toFixed(1)}% tax` : good;
  return (
    <div className="card flex min-w-0 flex-col gap-1.5 p-4">
      <span className="label">{title}</span>
      <span className="flex items-center gap-2 text-[16px] font-semibold"><span className={`size-2.5 shrink-0 rounded-full ${dot}`} /><span className="min-w-0 break-words">{text}</span></span>
      {extra && <span className="text-[12.5px] text-muted">{extra}</span>}
    </div>
  );
}

type Row = { label: string; state: "ok" | "bad" | "warn" | "skip"; text: string };
function SafetyTests({ r }: { r: TokenReport }) {
  const p = r.powers;
  const curve = r.launch?.model === "curve" && r.launch.graduated === false;
  const noOwner = !r.owner || p?.renounced;
  const own = (can: boolean | undefined): Row["state"] => (noOwner ? "ok" : !p ? "skip" : can ? "warn" : "ok");
  const ownText = (can: boolean | undefined, tested: boolean, yes: string) => (noOwner ? "No owner" : !p ? "Not tested" : can ? yes : tested ? "No" : "Not tested");
  const lp = r.liquidity?.lp;
  const rows: Row[] = [
    { label: "Owner can mint", state: own(p?.mint), text: ownText(p?.mint, true, "Yes, tested") },
    { label: "Owner can block a seller", state: p && !noOwner && !p.ownerTested && !p.blacklist ? "skip" : own(p?.blacklist), text: ownText(p?.blacklist, !!p?.ownerTested, "Yes, tested") },
    { label: "Owner can pause transfers", state: p && !noOwner && !p.ownerTested && !p.pause ? "skip" : own(p?.pause), text: ownText(p?.pause, !!p?.ownerTested, "Yes, tested") },
    { label: "Owner can raise the sell tax", state: noOwner ? "ok" : !p || !p.ownerTested ? "skip" : (p.maxSellTaxPct ?? 0) >= 50 ? "warn" : "ok", text: noOwner ? "No owner" : !p || !p.ownerTested ? "Not tested" : p.maxSellTaxPct !== null && p.maxSellTaxPct >= 10 ? `Up to ${p.maxSellTaxPct >= 100 ? "100% (no selling)" : `${p.maxSellTaxPct.toFixed(0)}%`}` : "No" },
    { label: "Code can be replaced", state: !p ? "skip" : p.upgradeable ? "warn" : "ok", text: !p ? "Not tested" : p.upgradeable ? "Yes, upgradeable proxy" : "No" },
    { label: "Sell still works in a week", state: p?.sellLater == null ? "skip" : p.sellLater ? "ok" : "bad", text: p?.sellLater == null ? "Not tested" : p.sellLater ? "Yes" : "No: time-locked" },
    { label: "0.1 ETH buy and sell", state: curve ? "skip" : p?.bigTrade == null ? "skip" : p.bigTrade ? "ok" : "warn", text: curve ? "Not tested on a curve" : p?.bigTrade == null ? "Not tested" : p.bigTrade ? "Works like a small one" : "Limited or taxed more" },
    { label: "Liquidity can be pulled", state: r.liquidity?.removed ? "bad" : curve ? "ok" : !lp ? "skip" : lp.walletPct >= 50 ? "warn" : "ok",
      text: r.liquidity?.removed ? "Already pulled" : curve ? `No, it sits in the ${r.launch?.launchpad} curve` : !lp ? "Not measured" : lp.walletPct >= 50 ? `${lp.walletPct.toFixed(0)}% held by a wallet` : lp.burnedPct + lp.lockedPct >= 50 ? `No, ${(lp.burnedPct + lp.lockedPct).toFixed(0)}% locked or burned` : lp.contractPct >= 50 ? `${lp.contractPct.toFixed(0)}% held by a contract` : "No single wallet holds most" },
  ];
  if (r.liquidity?.pairEth != null) rows.push({ label: "Pool depth", state: r.liquidity.pairEth < 0.05 ? "warn" : "ok", text: `${r.liquidity.pairEth < 10 ? r.liquidity.pairEth.toFixed(3) : r.liquidity.pairEth.toFixed(1)} ETH` });
  if (!r.powers && !r.liquidity) return null;
  const dot = { ok: "bg-allow", warn: "bg-warn", bad: "bg-deny", skip: "bg-line-strong" } as const;
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-[18px] font-semibold">Rug checks</h2><span className="text-[12.5px] text-muted">Each run as a simulation on chain, not read from claims</span></div>
      <ul className="grid gap-x-6 gap-y-2 text-[14.5px] sm:grid-cols-2">
        {rows.map((row) => <li key={row.label} className="flex items-center justify-between gap-3 border-b border-line pb-2"><span className="flex items-center gap-2"><span className={`size-2 shrink-0 rounded-full ${dot[row.state]}`} />{row.label}</span><span className="text-right text-muted">{row.text}</span></li>)}
      </ul>
    </section>
  );
}

async function Content({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  const a = getAddress(address);
  await connection();
  const { report: r, status } = await fetchTokenCheck(a);
  if (!r) {
    return (
      <section className="card flex flex-col gap-3 p-6">
        <h1 className="text-[28px]">Token Check could not finish</h1>
        <p className="text-muted">{status === 402 || status === 429 ? "You have used the free checks for now. Try again in a minute." : "Shield did not answer. Treat the token as unsafe until a check completes."}</p>
        <TokenCheckForm compact initial={a} />
      </section>
    );
  }
  const [box, color, head] = TONE[r.verdict];
  const notable = r.findings.filter((f) => f.severity !== "info").sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "deny" ? -1 : 1));
  const info = r.findings.filter((f) => f.severity === "info");
  const pulled = r.pullableBy.length ? `${r.pullableBy.includes("anyone") ? "Anyone" : "The owner"} can take it from your wallet` : "No one could pull it without approval";
  return (
    <>
      <header className="flex flex-col gap-2">
        <span className="eyebrow">Token Check</span>
        <h1 className="text-[40px] leading-tight md:text-[50px]">{r.symbol ?? "Unknown token"}{r.name && r.name !== r.symbol ? <span className="text-muted"> · {r.name}</span> : null}</h1>
        <a href={explorerAddress(a)} target="_blank" rel="noopener" className="break-all font-mono text-[13px] text-muted hover:text-brand">{a}</a>
        <div className="mt-2 flex flex-wrap items-start gap-3"><TokenCheckShare check={{ address: a, symbol: r.symbol ?? short(a), verdict: r.verdict, at: r.checkedAt }} /><WatchButton address={a} kind="token" /></div>
      </header>
      <section className={`flex flex-col gap-2 rounded-[3px] border p-5 sm:flex-row sm:items-center sm:gap-4 ${box}`}>
        <span className={`font-mono text-[28px] font-bold ${color}`}>{r.verdict}</span>
        <div className="min-w-0 flex-1"><p className={`text-[18px] font-semibold ${color}`}>{head}</p><p className="text-[14.5px] text-ink [overflow-wrap:anywhere]">{notable[0]?.message ?? "Buying, selling and moving it worked in the simulation, without a tax or a clawback."}</p></div>
        <span className="font-mono text-[13px] text-muted">risk {r.riskScore}/100</span>
      </section>
      <TokenAiSummary address={a} />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <LegCard title="Buy" leg={r.buy} good="Works, no tax" />
        <LegCard title="Sell" leg={r.sell} good="Works, no tax" />
        <LegCard title="Transfer" leg={r.transfer} good="Works, no tax" />
        <LegCard title="Clawback" leg={r.buy?.ok ? { ok: r.pullableBy.length === 0, taxPct: null, reason: r.pullableBy.length ? pulled.toLowerCase() : undefined } : null} good={pulled} />
      </section>
      <SafetyTests r={r} />
      {notable.length > 0 && (
        <section className="card flex flex-col gap-3 p-5">
          <h2 className="text-[18px] font-semibold">What Heimdall found</h2>
          <ul className="flex flex-col gap-2.5">{notable.map((f, i) => <li key={i} className="flex items-start gap-3 text-[15px] leading-relaxed"><span className={`mt-2 size-2 shrink-0 rounded-full ${SEV[f.severity]}`} /><span className="min-w-0 [overflow-wrap:anywhere]">{f.message}</span></li>)}</ul>
        </section>
      )}
      <section className="grid gap-3 text-[14px] md:grid-cols-2">
        <div className="card flex min-w-0 flex-col gap-1.5 p-4">
          <span className="label">Market</span>
          {r.launch?.model === "curve" && r.launch.graduated === false ? (
            <>
              <span className="font-semibold">{r.launch.launchpad} bonding curve{r.launch.feePct ? <span className="font-normal text-muted"> · {r.launch.feePct}% fee</span> : null}</span>
              {r.launch.progressPct !== null && <><span className="text-muted">{r.launch.progressPct.toFixed(1)}% of the way to graduating to Uniswap</span><span className="h-1.5 w-full overflow-hidden rounded-full bg-ink-2"><span className="block h-full bg-brand" style={{ width: `${Math.min(100, r.launch.progressPct)}%` }} /></span></>}
              {r.launch.curve && <a href={explorerAddress(r.launch.curve)} target="_blank" rel="noopener" className="font-mono text-[12.5px] text-muted hover:text-brand">curve {short(r.launch.curve)}</a>}
            </>
          ) : r.pool ? (r.pool.version === 4 ? (
            <><span className="break-all font-mono text-[12.5px]">{r.pool.address.slice(0, 18)}…</span><span className="text-muted">Uniswap v4 · {r.pool.pair} · {r.pool.fee === 0x800000 ? "dynamic fee" : `${(r.pool.fee / 10_000).toFixed(2)}% fee`}{r.pool.hooks && !/^0x0{40}$/i.test(r.pool.hooks) ? <> · hook <a href={explorerAddress(r.pool.hooks)} target="_blank" rel="noopener" className="font-mono hover:text-brand">{short(r.pool.hooks)}</a></> : " · no hook"}</span></>
          ) : <><a href={explorerAddress(r.pool.address)} target="_blank" rel="noopener" className="font-mono hover:text-brand">{short(r.pool.address)}</a><span className="text-muted">Uniswap v3 · {r.pool.pair} · {(r.pool.fee / 10_000).toFixed(2)}% fee</span></>) : <span className="text-muted">No Uniswap v3 or v4 pool against ETH or WETH</span>}
        </div>
        <div className="card flex min-w-0 flex-col gap-1.5 p-4">
          <span className="label">Owner</span>
          {r.owner ? <a href={explorerAddress(r.owner)} target="_blank" rel="noopener" className="font-mono hover:text-brand">{short(r.owner)}</a> : <span className="text-muted">None, or not exposed by owner()</span>}
          {info.filter((f) => f.code !== "HAS_OWNER" && f.code !== "LAUNCHPAD").map((f, i) => <span key={i} className="text-muted [overflow-wrap:anywhere]">{f.message}</span>)}
        </div>
      </section>
      {(r.launch || r.holders) && (
        <section className="grid gap-3 text-[14px] md:grid-cols-2">
          {r.launch && (
            <div className="card flex min-w-0 flex-col gap-1.5 p-4">
              <span className="label">Launch</span>
              <span className="font-semibold">{r.launch.url ? <a href={r.launch.url} target="_blank" rel="noopener" className="hover:text-brand">{r.launch.launchpad}</a> : r.launch.launchpad}<span className="font-normal text-muted"> · {r.launch.graduated === false ? "on the bonding curve" : r.launch.graduated ? "graduated" : r.launch.model === "curve" ? "bonding curve" : `Uniswap ${r.launch.model}`}</span></span>
              {r.launch.dev && <span className="text-muted">Dev <a href={`/check/${r.launch.dev}`} className="font-mono hover:text-brand">{short(r.launch.dev)}</a>{r.holders?.devPct != null ? ` · holds ${r.holders.devPct.toFixed(1)}%` : ""}{r.holders?.devSoldPct != null ? ` · sold or moved ${r.holders.devSoldPct.toFixed(0)}% of what they got` : ""}</span>}
              {r.holders?.devLaunches != null && <span className="text-muted">{r.holders.devLaunches === 0 ? "No other launches by this dev in about a month" : `${r.holders.devLaunches} other launch${r.holders.devLaunches === 1 ? "" : "es"} by this dev in about a month`}</span>}
            </div>
          )}
          {r.holders && (
            <div className="card flex min-w-0 flex-col gap-1.5 p-4">
              <span className="label">Holders</span>
              <span className="font-semibold">{r.holders.count.toLocaleString("en-US")} wallet{r.holders.count === 1 ? "" : "s"}{r.holders.top10Pct !== null ? <span className="font-normal text-muted"> · top 10 hold {r.holders.top10Pct.toFixed(1)}%</span> : null}</span>
              <ul className="flex flex-col gap-0.5">{r.holders.top.slice(0, 5).map((h) => <li key={h.address} className="flex justify-between gap-3 font-mono text-[12.5px]"><a href={`/check/${h.address}`} className="text-muted hover:text-brand">{short(h.address)}{h.address === r.holders?.dev ? " (dev)" : ""}</a><span>{h.pct.toFixed(2)}%</span></li>)}</ul>
              {r.holders.launchBuyers && r.holders.launchBuyers.wallets > 0 && <span className="text-muted">{r.holders.launchBuyers.wallets} wallet{r.holders.launchBuyers.wallets === 1 ? "" : "s"} bought in the first blocks; they hold {r.holders.launchBuyers.pct.toFixed(1)}% now</span>}
              <span className="text-[12px] text-muted">Pools, the curve and burn addresses are not counted.{r.holders.window === "recent" ? " Older than a month: based on wallets active in the last month." : ""}</span>
            </div>
          )}
        </section>
      )}
      <p className="text-[13px] text-muted">Simulated on the Robinhood Chain block at {new Date(r.checkedAt).toISOString().slice(0, 16).replace("T", " ")} UTC with a throwaway wallet. Owner powers are tested where the contract exposes them, by acting as the owner in the simulation; a contract can still hide behavior no test reaches. Holder and dev figures are read from the token&apos;s transfers on chain.</p>
      <section className="flex flex-col gap-3 border-t border-line pt-6"><h2 className="text-[18px] font-semibold">Check another token</h2><TokenCheckForm compact /></section>
    </>
  );
}
