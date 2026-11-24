import type { Metadata } from "next";
import { Faq } from "@/components/ProductSections";
import { WidgetBuilder } from "./WidgetBuilder";

export const metadata: Metadata = {
  title: "Token Check widget for launchpads, explorers and wallets",
  description: "Put Heimdall's Token Check on any token page: a live card or badge with the verdict, taxes, liquidity and the dev, from a simulated buy and sell on Robinhood Chain. Two lines of HTML, free.",
};

export default function Page() {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://heimdall.fund";
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-10 px-5 pb-20 pt-14 md:px-8">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Widget · free</span>
        <h1 className="max-w-[860px] text-[46px] leading-[0.95] md:text-[68px]">Token Check on every token page.</h1>
        <p className="max-w-[680px] text-[18px] leading-relaxed text-muted">For launchpads, explorers, wallets and trading bots on Robinhood Chain. Show your users whether a token can be sold, what it taxes, who can pull the liquidity and what the dev did before, right where they decide to buy. Two lines of HTML, or one image.</p>
      </header>
      <WidgetBuilder site={site} />
      <Faq items={[
        ["Where does the verdict come from?", "From Token Check on the current Robinhood Chain state: a simulated buy, sell and transfer on the token's bonding curve or Uniswap pool, owner powers tested as the owner, liquidity owners, the dev's earlier launches and who holds the supply. The card links to the full report."],
        ["How fresh is it?", "Each card is checked when it is first shown and then kept for up to five minutes. A token that changes (a tax raised, liquidity pulled) shows the new verdict on the next load."],
        ["Does it slow down my page or track my users?", "The card loads lazily in its own frame from heimdall.fund. It reads nothing from your page, sets no cookies, and sends only the token address."],
        ["Can I style it?", "Light and dark themes, and any width up to the frame you give it. For full control, call the API and render the result yourself: GET api.heimdall.fund/v1/token/{address}, free tier, no key needed."],
        ["Is it free?", "Yes, for any site. Heavy API use beyond the free tier pays per call in USDG with x402, no account needed."],
      ]} />
    </div>
  );
}
