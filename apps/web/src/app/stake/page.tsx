import type { Metadata } from "next";
import Link from "next/link";
import { ADDRESSES } from "@/lib/config";
import { Providers } from "@/components/Providers";
import { Faq, Steps } from "@/components/ProductSections";
import { LaunchBanner } from "@/components/Preview";
import { StakePanel } from "./StakePanel";

import { LogoRow } from "@/components/BrandLogo";
export const metadata: Metadata = { title: "Stake $HEIM", description: "Stake $HEIM and earn a share of Heimdall protocol fees, paid in USDG. No lock-up." };

export default function Page() {
  const live = ADDRESSES.staking && ADDRESSES.heim;
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-10 px-5 pb-20 pt-14 md:px-8">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Stake $HEIM</span>
        <h1 className="max-w-[760px] text-[50px] md:text-[68px]">Earn from every check, call and vault.</h1>
        <p className="max-w-[640px] text-[18px] leading-relaxed text-muted">Half of the protocol fees Heimdall collects in USDG go to $HEIM stakers. The rest funds the treasury. No lock-up, no emissions: only fees people actually paid.</p>
        <LogoRow className="mt-1" items={[{ token: "HEIM", label: "Stake $HEIM" }, { token: "USDG", label: "Earn USDG" }, { brand: "robinhood", label: "Robinhood Chain" }]} />
      </header>
      {live ? <Providers><StakePanel staking={ADDRESSES.staking!} heim={ADDRESSES.heim!} /></Providers>
        : <LaunchBanner>Staking opens when $HEIM launches. The contract is written, tested and goes live with the token.</LaunchBanner>}
      <Steps title="Where the USDG comes from" steps={[
        ["signal", "Fees are paid", "Signals take a cut of every paid call. Vaults pay a platform fee on profit. All of it goes to the fee splitter."],
        ["coins", "The splitter shares it", "Once a day the splitter sends the stakers' share to the staking contract and the rest to the treasury."],
        ["chart", "Stakers earn by the second", "Each payout streams over 7 days, pro rata to your stake. Claim any time."],
      ]} />
      <Faq items={[
        ["What share goes to stakers?", "50% of USDG fees at launch. The contract caps it at 80%; changing it needs the 2-of-3 Safe and is logged in the Trust center."],
        ["Is there a lock-up?", "No. You can withdraw your $HEIM and claim your USDG at any time."],
        ["Why is the payout streamed?", "So nobody can stake a large amount right before a payout and leave right after. Rewards go to people who stay staked."],
        ["Is this a promise of returns?", "No. Rewards depend entirely on fees people pay to use Heimdall, and can be zero. Read the risk disclosure before you stake."],
      ]} />
      <p className="text-[13px] text-muted">See the <Link href="/legal/risk" className="font-medium text-brand hover:underline">risk disclosure</Link> and the <Link href="/token" className="font-medium text-brand hover:underline">$HEIM page</Link>.</p>
    </div>
  );
}
