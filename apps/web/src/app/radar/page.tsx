import type { Metadata } from "next";
import { RadarList } from "./RadarList";

export const metadata: Metadata = {
  title: "Launch Radar: new Robinhood Chain tokens, checked",
  description: "Every token launched on Robinhood Chain in the last 24 hours, ranked by how many wallets bought it in the last hour, with Heimdall's Token Check verdict: honeypots, owner powers, liquidity that can be pulled, dev selling.",
};

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-5 pb-24 pt-12 md:px-8">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Launch Radar · live</span>
        <h1 className="text-[44px] leading-tight md:text-[60px]">What launched, who is buying, and is it a trap</h1>
        <p className="max-w-[720px] text-[16.5px] leading-relaxed text-muted">Tokens launched on Robinhood Chain in the last 24 hours, on Pons, Klik and Uniswap, ranked by how many different wallets bought in the last hour. The busiest are run through Token Check: a real buy and sell in simulation, owner powers, liquidity and the dev. Activity is counted from onchain transfers. Nothing here predicts a price.</p>
      </header>
      <RadarList />
    </div>
  );
}
