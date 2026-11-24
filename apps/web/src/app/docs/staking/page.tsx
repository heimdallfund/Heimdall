import type { Metadata } from "next";
import { H1, H2, Table, C } from "@/components/docs/Docs";

export const metadata: Metadata = { title: "Staking $HEIM", description: "Stake $HEIM and earn a share of protocol fees in USDG." };

export default function Page() {
  return (
    <>
      <H1 lead={<>Stakers earn a share of the USDG fees Heimdall collects. There are no emissions: rewards come only from fees people paid.</>}>Staking $HEIM</H1>
      <H2 id="how-fees-reach-stakers">How fees reach stakers</H2>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Every protocol fee goes to <strong>HeimdallFeeSplitter</strong>: the vault platform fee (5% of profit above the high-water mark, 2.5% for holder managers), the Signals fee (10%, 5% for holders), the Pay fee (1% of what a provider earns), the Auto-Invest fee (0.25% per buy) and Shield API payments made over x402. Vault fees arrive as vault shares, which the treasury redeems and sends back as USDG.</li>
        <li>Once a day, anyone (the monitor does it) calls <C>{"distribute(USDG)"}</C>. The stakers&apos; share (50% at launch, capped at 80% by the contract) goes to <strong>HeimdallStaking</strong>. The rest goes to the treasury.</li>
        <li>Each payout streams to stakers over 7 days, pro rata to their stake. Claim at any time.</li>
      </ol>
      <p>Streaming means a stake made right before a payout and pulled right after earns almost nothing. Rewards that arrive while nobody stakes are kept for the next stakers.</p>
      <H2 id="contract">Contract</H2>
      <Table head={["Function", "What it does"]} rows={[
        [<><C>{"stake(amount)"}</C></>, <>Stake $HEIM</>],
        [<><C>{"withdraw(amount)"}</C></>, <>Unstake; no lock-up</>],
        [<><C>{"claim()"}</C></>, <>Collect earned USDG</>],
        [<><C>{"exit()"}</C></>, <>Withdraw everything and claim</>],
        [<><C>{"earned(user)"}</C></>, <>USDG claimable now</>],
        [<><C>{"rewardPerDay()"}</C></>, <>USDG streamed to all stakers per day right now</>],
      ]} />
      <p>HeimdallStaking has no owner and no admin functions. The splitter&apos;s share and treasury can only be changed by the 2-of-3 Safe.</p>
      <H2 id="staking-keeps-your-holder-benefits">Staking keeps your holder benefits</H2>
      <p>Staked $HEIM still counts as held. Every holder check (the bigger Shield quota, the lower vault and Signals fees, the Guardian badge) reads <C>{"HeimdallHolderBalance"}</C>, which adds the $HEIM in your wallet to the $HEIM you have staked.</p>
    </>
  );
}
