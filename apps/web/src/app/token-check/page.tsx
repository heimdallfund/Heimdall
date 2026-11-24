import type { Metadata } from "next";
import { Faq } from "@/components/ProductSections";
import { IconTile } from "@/components/Icons";
import { FacetDivider } from "@/components/Motif";
import { TokenCheckForm } from "./TokenCheckForm";
import { RecentChecks } from "./TokenCheckShare";

export const metadata: Metadata = {
  title: "Token Check: Robinhood Chain honeypot checker",
  description: "Paste any Robinhood Chain token: Heimdall simulates a real buy, sell and transfer on the current chain state and tells you if it is a honeypot, taxes you, can be clawed back from your wallet, or fakes a real ticker.",
};

export default function Page() {
  return (
    <div className="mx-auto max-w-[1120px] px-5 md:px-8">
      <section className="flex flex-col items-center gap-6 pb-14 pt-16 text-center md:pt-24">
        <span className="eyebrow">Token Check · free</span>
        <h1 className="max-w-[860px] text-[50px] md:text-[75px]">Can you sell it after you buy it?</h1>
        <p className="max-w-[640px] text-[18px] leading-relaxed text-muted">Paste a token, including memecoins still on a launchpad. Heimdall simulates a real buy and sell on its bonding curve or Uniswap pool on the current state of Robinhood Chain, then checks the traps a chart cannot show you: the dev, who holds the supply, and the code.</p>
        <TokenCheckForm />
        <RecentChecks />
      </section>
      <FacetDivider />
      <section className="grid gap-4 py-14 md:grid-cols-3">
        {([
          ["coins", "Buy, sell and transfer", "A throwaway wallet buys 0.001 ETH of the token, sells it back and sends it on. A sell that reverts is a honeypot; taxes are measured, not read from the contract."],
          ["alert", "Clawbacks", "Can a stranger, or the token's owner, take it out of your wallet without your approval? That hidden backdoor is how tokens vanish after a buy."],
          ["shield", "Fakes and known scams", "A copy of USDG, NVDA or another known ticker at the wrong address, look-alike letters included, and every address on the sourced Heimdall blocklist."],
        ] as const).map(([icon, t, d]) => (
          <div key={t} className="card flex flex-col gap-3 p-6"><IconTile name={icon} /><h2 className="text-[18px] font-semibold">{t}</h2><p className="text-[15px] leading-relaxed text-muted">{d}</p></div>
        ))}
      </section>
      <Faq items={[
        ["Does this buy anything or need my wallet?", "No. Everything runs in a simulation of the current block with a throwaway wallet that is given 1 ETH for the simulation only. Nothing is sent to the chain."],
        ["Why not honeypot.is?", "It does not support Robinhood Chain. Token Check is built for chain 4663 and uses the same engine as Shield, which agents call before they sign."],
        ["Does it work for memecoins still on a launchpad?", "Yes. Pons tokens still on their bonding curve are bought and sold on the curve itself, also when the curve is priced in another token. Tokens from Klik, DYOR.fun, Bow.fun, RealFun, Noxa and other launchpads that trade in a Uniswap pool from the start are tested in that pool. The launchpad, the dev wallet, how far the curve is from graduating, the dev's share and sales, the top holders, wallets that bought in the first blocks and the dev's other launches are shown too."],
        ["What does the AI do?", "It explains the result in plain words. It only sees the checks on the page and cannot change the verdict, which always comes from the simulation."],
        ["Which pools does it use?", "The Uniswap v3 pool against WETH with the most liquidity, or else the deepest Uniswap v4 pool against ETH or WETH, swapped through the Universal Router. For v4 pools, the hook is read too: one that can change swap amounts can charge a hidden fee. Tokens with neither get the other checks and a note that the buy and sell could not be simulated."],
        ["Is a clean result a guarantee?", "No. It shows what the token does right now. An owner can still change fees or pause trading later, so a token with an owner deserves more care, and the check is worth running again before a large buy."],
      ]} />
    </div>
  );
}
