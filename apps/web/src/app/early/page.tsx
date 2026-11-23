import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Providers } from "@/components/Providers";
import { IconTile } from "@/components/Icons";
import { Faq } from "@/components/ProductSections";
import { SHIELD_API_URL } from "@/lib/config";
import { EarlyForm } from "./EarlyForm";

export const metadata: Metadata = {
  title: "Early access",
  description: "Get on the Heimdall list before launch: 100 Guardian Points for your wallet, and an invite link that pays when your friends really use Heimdall.",
};

async function Count() {
  await connection();
  const s = await fetch(`${SHIELD_API_URL}/v1/early`, { signal: AbortSignal.timeout(4_000) }).then((r) => r.json() as Promise<{ count: number; open: boolean; until: number | null }>).catch(() => null);
  if (!s) return null;
  return (
    <p className="text-[15px] text-muted"><span className="font-mono text-[17px] font-semibold text-ink">{s.count.toLocaleString("en-US")}</span> wallets on the list{s.until ? ` · closes ${new Date(s.until).toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}{s.open ? "" : " · closed"}</p>
  );
}

const STEPS: ["key" | "check" | "sparkle", string, string][] = [
  ["key", "Sign in with your wallet", "One signature, no gas. The wallet needs at least one transaction on Robinhood Chain."],
  ["check", "Get 100 Guardian Points", "They sit on your record from day one and count for Season 1."],
  ["sparkle", "Invite friends", "100 points for each friend who really uses Heimdall after launch: a stake, a Pay job, a vault deposit or a confirmed drainer report."],
];

export default function EarlyPage() {
  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-12 px-6 pb-24 pt-14">
      <header className="flex flex-col items-center gap-4 text-center">
        <span className="eyebrow">Early access</span>
        <h1 className="max-w-[760px] text-[52px] md:text-[73px]">Be early to the guardian layer.</h1>
        <p className="max-w-[600px] text-[18px] leading-relaxed text-muted">Heimdall keeps AI agents and wallets on Robinhood Chain from signing what they shouldn&apos;t. Get on the list before launch.</p>
        <Suspense fallback={<p className="h-6" />}><Count /></Suspense>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.1fr]">
        <ol className="flex flex-col gap-4">
          {STEPS.map(([icon, t, d], i) => (
            <li key={t} className="card flex gap-4 p-5"><IconTile name={icon} /><div><p className="font-semibold">{i + 1}. {t}</p><p className="mt-1 text-[14.5px] leading-relaxed text-muted">{d}</p></div></li>
          ))}
        </ol>
        <Providers><EarlyForm /></Providers>
      </div>
      <Faq items={[
        ["Why does my wallet need a transaction on Robinhood Chain?", "So the list is people, not thousands of empty wallets. Any past transaction counts."],
        ["Do points from friends count for sign-ups alone?", "No. You earn when an invited wallet first does something real: stakes at least 1,000 $HEIM, pays for a job of at least 10 USDG, holds USDG in a vault, or files a drainer report that a reviewer confirms. Up to 25 friends count per season."],
        ["Are points a token?", "No. Guardian Points are an offchain record of participation. They are not transferable and carry no promise of value."],
        ["What do I sign?", "A plain message that proves you own the wallet. It is not a transaction, moves nothing and costs no gas."],
      ]} />
    </div>
  );
}
