import type { Metadata } from "next";
import { ADDRESSES } from "@/lib/config";
import { Providers } from "@/components/Providers";
import { LaunchBanner } from "@/components/Preview";
import { Faq, Steps } from "@/components/ProductSections";
import { InvestPanel } from "./InvestPanel";

export const metadata: Metadata = { title: "Auto-Invest", description: "Buy NVDA, TSLA or GOOGL stock tokens on a schedule with USDG, straight from your own wallet, never above the Chainlink price you allow." };

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-10 px-5 pb-20 pt-14 md:px-8">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Auto-Invest</span>
        <h1 className="max-w-[780px] text-[50px] md:text-[68px]">Buy stocks on autopilot. Never at a bad price.</h1>
        <p className="max-w-[640px] text-[18px] leading-relaxed text-muted">Pick a stock, an amount and how often. Each buy comes out of your own wallet, lands back in it, and only goes through within the price bound you set against Chainlink.</p>
      </header>
      {ADDRESSES.autoInvest ? <Providers><InvestPanel ai={ADDRESSES.autoInvest} /></Providers> : <LaunchBanner>Auto-Invest opens with the mainnet launch. The contract is written and tested against real Uniswap pools.</LaunchBanner>}
      <Steps title="What happens on each buy" steps={[
        ["eye", "Checked against Chainlink", "The buy only runs while the stock's Chainlink price is fresh, and never while Robinhood has paused it for a corporate action."],
        ["bolt", "Swapped on Uniswap", "Your USDG is swapped on the deepest Uniswap pool for that stock. A fill worse than your bound reverts and nothing is spent."],
        ["allow", "Delivered to you", "The stock goes straight to your wallet. Nobody can change the amount, the recipient or the price limit."],
      ]} />
      <Faq items={[
        ["Who holds my money?", "You do. Auto-Invest only has an allowance for the budget you approve, and takes one buy's worth at a time. Revoke the allowance or stop the plan whenever you want."],
        ["Which stocks can I buy?", "NVDA, TSLA and GOOGL at launch: the stock tokens with 24/7 Chainlink feeds on Robinhood Chain. More come as feeds are added."],
        ["What does it cost?", "0.25% of each buy, paid to $HEIM stakers, plus the Uniswap pool fee."],
        ["Are stock tokens available to everyone?", "No. Robinhood Stock Tokens are not offered to US persons and have their own restrictions. Check Robinhood's terms for your country before you buy."],
      ]} />
    </div>
  );
}
