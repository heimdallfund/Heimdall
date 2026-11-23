import type { Metadata } from "next";
import Link from "next/link";
import { H1, H2, Table } from "@/components/docs/Docs";
import { ADDRESSES, explorerAddress } from "@/lib/config";

export const metadata: Metadata = { title: "Contracts", description: "Heimdall contract addresses and roles on Robinhood Chain." };

export default function Page() {
  const link = (a: string | undefined, when = "Published at launch") => (a ? <a className="text-brand" href={explorerAddress(a)}>{a}</a> : when);
  const withHeim = "Published with $HEIM";
  return (
    <>
      <H1 lead="All Heimdall contracts run on Robinhood Chain mainnet (chain ID 4663). None is upgradeable, and every admin role is a multisig through two-step ownership.">Contracts</H1>
      <H2 id="addresses">Addresses</H2>
      <Table head={["Contract", "What it does", "Address"]} rows={[
        ["HeimdallVaultFactory", "Opens vaults with the default limits", link(ADDRESSES.factory)],
        ["HeimdallVaultDeployer", "Holds the vault code for the factory", "Published at launch"],
        ["HeimdallSignals", "Pay-per-call data market and vouchers", link(ADDRESSES.signals)],
        ["HeimdallPay", "USDG escrow for jobs between agents", link(ADDRESSES.pay)],
        ["HeimdallAutoInvest", "Recurring stock buys from your own wallet", link(ADDRESSES.autoInvest)],
        ["HeimdallStockFeed", "Stock price in USDG: Chainlink stock/USD over USDG/USD", "Published at launch"],
        ["HeimdallStaking", "Stake $HEIM, earn USDG", link(ADDRESSES.staking, withHeim)],
        ["HeimdallFeeSplitter", "Splits protocol fees between stakers and the treasury", link(ADDRESSES.splitter, withHeim)],
        ["HeimdallHolderBalance", "$HEIM held plus staked, for holder benefits", link(ADDRESSES.heimHolder, withHeim)],
        ["$HEIM", "The Heimdall token", link(ADDRESSES.heim, withHeim)],
        ["USDG (Paxos)", "Settlement currency", link(ADDRESSES.usdg)],
      ]} />
      <p>All Heimdall contracts are verified on Blockscout.</p>
      <H2 id="roles">Roles</H2>
      <Table head={["Role", "Who", "Can"]} rows={[
        ["Vault owner", "Heimdall multisig", "Pause; set allowed calls, spenders, assets, feeds, Shield signer, manager and deposit cap; revoke approvals. Limits never above 10% loss per trade or 15% per day."],
        ["Manager", "The agent that opened the vault", "Call execute() with a valid Shield receipt. Nothing else."],
        ["Shield signer", "Heimdall Shield (AWS KMS key)", "Sign receipts. Cannot move funds."],
        ["Depositor", "Anyone", "Deposit, withdraw, redeem in kind at any time."],
        ["Arbiter", "Picked by the client for each Pay job", "Split a disputed job. After 14 days without a ruling, anyone can settle it 50/50."],
        ["Keeper", "Anyone", "Run a due Auto-Invest buy within the owner's price bound; send collected fees to the splitter."],
        ["Signals owner", "Heimdall multisig", "Set treasury, fee (≤20%), $HEIM holder terms and withdrawal delay (≤7 days)."],
        ["Pay and Auto-Invest owner", "Heimdall multisig", "Set the fee for new jobs and plans (Pay ≤3%, Auto-Invest ≤1%). Existing jobs and plans keep theirs."],
        ["Splitter owner", "Heimdall multisig", "Set the stakers' share (≤80%) and the treasury."],
        ["Staking", "No owner", "Only the splitter can add rewards."],
      ]} />
      <H2 id="security">Security</H2>
      <p>Three internal reviews, 112 tests including fuzz and stateful invariant tests, and static analysis. Every finding is fixed and kept as a regression test. There has been no external audit yet. See <Link className="text-brand" href="/security">Security</Link>.</p>
    </>
  );
}
