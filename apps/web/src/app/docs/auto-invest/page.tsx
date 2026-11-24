import type { Metadata } from "next";
import { H1, H2, Table, C } from "@/components/docs/Docs";

export const metadata: Metadata = { title: "Auto-Invest", description: "Recurring stock-token buys with USDG, straight from your own wallet, inside a Chainlink price bound." };

export default function Page() {
  return (
    <>
      <H1 lead={<>Auto-Invest buys a stock token on a schedule with USDG. You choose the stock, the amount per buy, how often, how many buys, and the worst price you accept versus Chainlink.</>}>Auto-Invest</H1>
      <H2 id="how-a-buy-runs">How a buy runs</H2>
      <ol className="list-decimal space-y-2 pl-5">
        <li>A keeper calls <C>{"execute(planId)"}</C> when the plan is due. Anyone can be the keeper; Heimdall runs one.</li>
        <li>The contract reads the stock&apos;s Chainlink price through <C>{"HeimdallStockFeed"}</C>. It refuses to buy while the price is stale or Robinhood has paused the stock&apos;s oracle.</li>
        <li>It takes exactly one buy&apos;s USDG from your wallet and swaps it on the stock&apos;s Uniswap v3 pool. It requires at least <C>{"amount / price \u00d7 (1 \u2212 maxSlippage)"}</C> tokens out, and sends them straight to you.</li>
      </ol>
      <p>The keeper cannot change the amount, the recipient or the price bound. One buy is due per interval; after downtime, buys do not pile up.</p>
      <H2 id="contract">Contract</H2>
      <Table head={["Function", "What it does"]} rows={[
        [<><C>{"createPlan(token, amountPerBuy, interval, buys, maxSlippageBps)"}</C></>, <>Start a plan (interval ≥ 1 hour, slippage ≤ 5%)</>],
        [<><C>{"cancelPlan(id)"}</C></>, <>Stop it</>],
        [<><C>{"execute(id)"}</C></>, <>Run a due buy</>],
        [<><C>{"oraclePrice(token)"}</C></>, <>The price used, or 0 while stale or paused</>],
      ]} />
      <p>Approve <C>{"amountPerBuy \u00d7 buys"}</C> USDG to the contract first; the SDK&apos;s <C>{"HeimdallAutoInvest.createPlan"}</C> does both.</p>
      <p><strong>Fee:</strong> 0.25% per buy (capped at 1%), paid to $HEIM stakers. A plan keeps the fee it started with for its whole life, even if the fee changes later. <strong>Stocks:</strong> 16 stock tokens with a Chainlink feed and a USDG pool on Uniswap. NVDA, TSLA and GOOGL are priced 24/7. AMZN, AAPL, MSFT, META, COIN, QQQ, SPCX, GME, MU, CRCL, DELL, USO and SGOV are priced Monday to Friday: from Saturday 00:00 to Monday 01:00 UTC their price counts as closed, and a buy due then runs once Monday&apos;s price arrives.</p>
      <p>Robinhood Stock Tokens are not offered to US persons; check the terms for your country.</p>
    </>
  );
}
