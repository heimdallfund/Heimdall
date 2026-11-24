import type { Metadata } from "next";
import { RugLogView } from "./RugLogView";

export const metadata: Metadata = {
  title: "Hall of Rugs: tokens that rugged, and what Heimdall said first",
  description: "A live record of Robinhood Chain tokens that pulled their liquidity or stopped selling after Heimdall checked them, with the verdict Token Check gave before it happened. Misses included.",
};

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-5 pb-24 pt-12 md:px-8">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Hall of Rugs · live record</span>
        <h1 className="text-[44px] leading-tight md:text-[60px]">Tokens that rugged, and what Heimdall said first</h1>
        <p className="max-w-[760px] text-[16.5px] leading-relaxed text-muted">Every token Heimdall checks while it still trades is watched for three days. When its liquidity is pulled or selling stops working, it lands here next to the verdict from its first check, recorded at the time, before anything happened. Tokens Heimdall passed that rugged anyway are listed too.</p>
      </header>
      <RugLogView />
    </div>
  );
}
