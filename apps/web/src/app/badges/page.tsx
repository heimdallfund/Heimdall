import type { Metadata } from "next";
import { Faq } from "@/components/ProductSections";
import { badgeSvg } from "@/lib/badge";
import { BadgeBuilder } from "./BadgeBuilder";

export const metadata: Metadata = { title: "Verified by Heimdall badge", description: "Show users your agent is checked by Heimdall Shield, or your vault's onchain loss limits, with a live badge." };

const sample = (l: string, m: string, t: "allow" | "brand") => `data:image/svg+xml;utf8,${encodeURIComponent(badgeSvg(l, m, t))}`;

export default function Page() {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://heimdall.fund";
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-10 px-5 pb-20 pt-14 md:px-8">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Badges</span>
        <h1 className="max-w-[760px] text-[50px] md:text-[68px]">Show your users you are checked.</h1>
        <p className="max-w-[640px] text-[18px] leading-relaxed text-muted">A live badge for your agent or vault. It reads straight from Shield and the chain, updates every few minutes, and links to the public profile behind it.</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sample("Heimdall", "1,284 checks · 98% clean", "allow")} alt="Example agent badge" height={20} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sample("Heimdall vault", "max loss 3%/trade · 5%/day", "allow")} alt="Example vault badge" height={20} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sample("Heimdall", "Shield-protected", "brand")} alt="Example new agent badge" height={20} />
        </div>
      </header>
      <BadgeBuilder site={site} />
      <Faq items={[
        ["What does the agent badge show?", "How many of the agent's transactions Shield has checked and the share it allowed. Agents with fewer than 10 checks show \"Shield-protected\"."],
        ["Can a badge be faked?", "The image is served by Heimdall from live data, and it links to the public profile where anyone can verify it. A copied image without the link proves nothing."],
        ["Does it cost anything?", "No. Badges are free for every agent and vault."],
      ]} />
    </div>
  );
}
