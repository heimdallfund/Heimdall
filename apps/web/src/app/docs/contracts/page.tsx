import type { Metadata } from "next";
import Link from "next/link";
import { H1, H2, Table } from "@/components/docs/Docs";
import { Suspense } from "react";
import { connection } from "next/server";
import { ADDRESSES, ERC8004, explorerAddress } from "@/lib/config";
import { heimAddress } from "@/lib/heim";

export const metadata: Metadata = { title: "Contracts", description: "Heimdall contract addresses and roles on Robinhood Chain." };

async function HeimLink() {
  await connection();
  const a = await heimAddress();
  return a ? <a className="text-brand" href={explorerAddress(a)}>{a}</a> : <>Published with $HEIM</>;
}

export default function Page() {
  const link = (a: string | undefined, when = "Published at launch") => (a ? <a className="text-brand" href={explorerAddress(a)}>{a}</a> : when);
  const withHeim = "Published with $HEIM";
  return (
    <>
      <H1 lead="All Heimdall contracts run on Robinhood Chain mainnet (chain ID 4663). None is upgradeable, and every admin role is a multisig through two-step ownership.">Contracts</H1>
      <H2 id="addresses">Addresses</H2>
      <Table head={["Contract", "What it does", "Address"]} rows={[
        ["HeimdallVaultFactory", "Opens vaults with the default limits", link(ADDRESSES.factory)],
        ["HeimdallVaultDeployer", "Holds the vault code for the factory", link("0x59c2385ee4876405f535f6fcf8f7f566f48cb9fb")],
        ["HeimdallSignals", "Pay-per-call data market and vouchers", link(ADDRESSES.signals)],
        ["HeimdallPay", "USDG escrow for jobs between agents", link(ADDRESSES.pay)],
        ["HeimdallAutoInvest", "Recurring stock buys from your own wallet", link(ADDRESSES.autoInvest)],
        ["HeimdallStockFeed", "Stock price in USDG: Chainlink stock/USD over USDG/USD", <>NVDA {link("0x1b8a95850fe344ddf67b98b61de9b5a1417edc8f")}, TSLA {link("0xf7d7b2f8b73a5b2828625f23c2a892baf50d6d34")}, GOOGL {link("0x51196319a3108269fe7f14d7a05b846f27be63f7")}</>],
        ["HeimdallWeekdayFeed", "Weekday stocks: the stock price in USDG, closed Saturday 00:00 to Monday 01:00 UTC (each wraps its own HeimdallStockFeed)", <>AMZN {link("0x4cb68ac957a2485e01c313a4422bb40bd420e224")}, AAPL {link("0x7f6a012be52d3d5108648b1fc9e4ed0cf29a5666")}, MSFT {link("0x1bd6f9067c9ff8738ec02fb540fcca688d461a92")}, META {link("0xedba6246ce68390fd8d03a2e776e06b88e11c8c1")}, COIN {link("0x935b7a429d2fe4fea460ce28cc7d96005b119c0b")}, QQQ {link("0x172545fc5e1ab84f95f16c7ee5d20c57a2134068")}, SPCX {link("0x404776bd5c27f2450f62aa346e0d01f8f88c3843")}, GME {link("0x2648b4778c0c9e9b07a84ac9a9f1484b5d2fe2e5")}, MU {link("0x898ceae594b4664f5254233f7138b2975e52741f")}, CRCL {link("0xe0630690fd714351bf981fcb3be9246584a4dd83")}, DELL {link("0xbc7959386bef93115cd2fd43af9d41d1e5c1237c")}, USO {link("0x4de17a3a0b10cafe8ba4e87b9ee7a69b379a94a9")}, SGOV {link("0xa4bc3aeaef4712c622f5c18f7a73d78e5cf4a460")}</>],
        ["HeimdallRiskOracle", "Onchain risk levels of known-bad addresses, free to read", link(ADDRESSES.riskOracle)],
        ["HeimdallGuardModule", "Safe module: agents spend with Shield receipts and daily limits", link(ADDRESSES.guardModule)],
        ["HeimdallStaking", "Stake $HEIM, earn USDG", link(ADDRESSES.staking, withHeim)],
        ["HeimdallFeeSplitter", "Splits protocol fees between stakers and the treasury", link(ADDRESSES.splitter, withHeim)],
        ["HeimdallHolderBalance", "$HEIM held plus staked, for holder benefits", link(ADDRESSES.heimHolder, withHeim)],
        ["$HEIM", "The Heimdall token", <Suspense key="heim" fallback="…"><HeimLink /></Suspense>],
        ["ERC-8004 Identity Registry", "Official agent identities (not Heimdall's)", link(ERC8004.identity)],
        ["ERC-8004 Reputation Registry", "Where Heimdall publishes agent scores (not Heimdall's)", link(ERC8004.reputation)],
        ["USDG (Paxos)", "Settlement currency", link(ADDRESSES.usdg)],
      ]} />
      <p>Deployed 2026-11-24 at block 122,057,226. Admin Safe (2 of 3 signers): {link("0xaF1c3b55D204899CEd14d23C996153bC82424168")}. Every contract is source-verified on <a href="https://repo.sourcify.dev/4663/0x838fdede1ae6fbdc15f784030d78ca7543d1154d" target="_blank" rel="noreferrer">Sourcify</a>: the deployed bytecode matches this repository at the commit that was deployed.</p>
      <H2 id="roles">Roles</H2>
      <Table head={["Role", "Who", "Can"]} rows={[
        ["Vault owner", "Heimdall multisig", "Pause; set allowed calls, spenders, assets, feeds, Shield signer, manager and deposit cap; revoke approvals. Limits never above 10% loss per trade or 15% per day."],
        ["Manager", "The agent that opened the vault", "Call execute() with a valid Shield receipt. Nothing else."],
        ["Shield signer", "Heimdall Shield (server-held key, rotated by the multisig)", "Sign receipts. Cannot move funds."],
        ["Depositor", "Anyone", "Deposit, withdraw, redeem in kind at any time."],
        ["Arbiter", "Picked by the client for each Pay job", "Split a disputed job. After 14 days without a ruling, anyone can settle it 50/50."],
        ["Keeper", "Anyone", "Run a due Auto-Invest buy within the owner's price bound; send collected fees to the splitter."],
        ["Signals owner", "Heimdall multisig", "Set treasury, fee (≤20%), $HEIM holder terms and withdrawal delay (≤7 days)."],
        ["Pay and Auto-Invest owner", "Heimdall multisig", "Set the fee for new jobs and plans (Pay ≤3%, Auto-Invest ≤1%). Existing jobs and plans keep theirs."],
        ["Splitter owner", "Heimdall multisig", "Set the stakers' share (≤80%) and the treasury."],
        ["Staking", "No owner", "Only the splitter can add rewards."],
        ["Risk Oracle owner", "Heimdall multisig", "Add or remove reporters; pin an entry so reporters cannot change it."],
        ["Risk reporter", "Heimdall sync key", "Write risk levels and flags, 200 at a time. Nothing else."],
        ["Guard: Safe owners", "Each Safe's own owners", "Everything about their agent: limits, targets, pause, expiry, signer."],
        ["Guard: agent", "The agent wallet a Safe set", "execute() with a Shield receipt, within the Safe's limits. Never the Safe or the module."],
        ["Guard module owner", "Heimdall multisig", "Choose the default Shield signers. Nothing in any Safe."],
      ]} />
      <H2 id="security">Security</H2>
      <p>Six internal reviews, 150+ tests including fuzz and stateful invariant tests, and static analysis. Every finding is fixed and kept as a regression test. There has been no external audit yet. See <Link className="text-brand" href="/security">Security</Link>.</p>
    </>
  );
}
