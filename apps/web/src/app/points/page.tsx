import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { fetchLeaderboard } from "@/lib/shield";
import { explorerAddress, short } from "@/lib/config";
import { Providers } from "@/components/Providers";
import { IconTile } from "@/components/Icons";
import { ScanLoader } from "@/components/Motif";
import { PreviewBadge } from "@/components/Preview";
import { Faq } from "@/components/ProductSections";
import { MyPoints, ReportForm } from "./PointsTools";

export const metadata: Metadata = { title: "Guardian Points", description: "Earn Guardian Points for making Robinhood Chain safer: revoke risky approvals, report drainers, use Shield and hold in Heimdall vaults." };

const WAYS = [
  ["shield", "Revoke a risky approval", "+50", "Each dangerous or unknown approval Wallet Check finds and you revoke.", "/check"],
  ["alert", "Report a drainer", "+200", "When a reviewer confirms it. The address joins the blocklist.", "#report"],
  ["vault", "Hold in a vault", "+1 / day", "Per 100 USDG you hold in Heimdall vaults, every day.", "/vaults"],
  ["code", "Use Shield in your agent", "+1", "Per 100 transaction checks made with your API key.", "/app/keys"],
  ["sparkle", "Invite a friend", "+100", "When a wallet you invited first stakes, pays for a job, holds in a vault or files a confirmed report.", "/early"],
  ["coins", "First stake or Pay job", "+25", "Each once: a stake of at least 1,000 $HEIM, and a Pay job of at least 10 USDG.", "/stake"],
] as const;

async function Board() {
  const rows = (await fetchLeaderboard()) ?? [];
  if (!rows.length) return <div className="flex items-center gap-3 px-5 py-6 text-[14.5px] text-muted"><PreviewBadge />The leaderboard starts with the first points after launch.</div>;
  return (
    <ol className="divide-y divide-line">
      {rows.map((r, i) => (
        <li key={r.address} className="flex items-center justify-between px-5 py-3 text-[15px]">
          <span className="flex items-center gap-4"><span className={`w-8 font-mono text-[14px] ${i < 3 ? "font-semibold text-brand" : "text-muted"}`}>#{i + 1}</span><a href={explorerAddress(r.address)} target="_blank" rel="noopener" className="font-mono hover:underline">{short(r.address)}</a></span>
          <span className="font-mono font-semibold">{r.total.toLocaleString("en-US")}</span>
        </li>
      ))}
    </ol>
  );
}

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-12 px-5 pb-20 pt-14 md:px-8">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Guardian Points · Season 1</span>
        <h1 className="max-w-[780px] text-[50px] md:text-[68px]">Make the chain safer. Get on the board.</h1>
        <p className="max-w-[640px] text-[18px] leading-relaxed text-muted">Points go to people who actually reduce risk on Robinhood Chain. Every point comes from something checkable onchain or reviewed by a person.</p>
      </header>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {WAYS.map(([icon, t, pts, d, href]) => (
          <Link key={t} href={href} className="card card-hover flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between"><IconTile name={icon} /><span className="font-mono text-[18px] font-semibold text-brand">{pts}</span></div>
            <h2 className="text-[16px] font-semibold">{t}</h2><p className="text-[14px] leading-relaxed text-muted">{d}</p>
          </Link>
        ))}
      </section>
      <div className="grid items-start gap-5 lg:grid-cols-[1.3fr_1fr]">
        <section className="card min-w-0 overflow-hidden"><div className="border-b border-line px-5 py-4"><h2 className="text-[17px] font-semibold">Leaderboard</h2></div>
          <Suspense fallback={<div className="flex justify-center p-8"><ScanLoader /></div>}><Board /></Suspense></section>
        <Providers><div className="flex flex-col gap-5"><MyPoints /><div id="report"><ReportForm /></div></div></Providers>
      </div>
      <Faq items={[
        ["Are points a token?", "No. Guardian Points are an offchain record of what you did to make the chain safer. They are not transferable and carry no promise of value."],
        ["Can points be gamed?", "Revokes are checked against the transaction receipt, only count for approvals Wallet Check flagged, and earn points at most 5 times a day and 25 times a season. Reports pay only after review. Deposit points use daily onchain snapshots. Invites pay only when the friend does something real, never for sign-ups."],
        ["What happens at the end of a season?", "Seasons and any rewards tied to them are announced on the Heimdall X account before they start."],
      ]} />
    </div>
  );
}
