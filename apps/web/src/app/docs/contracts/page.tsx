import type { Metadata } from "next";
import { H1, H2, Table } from "@/components/docs/Docs";
import { ADDRESSES, explorerAddress } from "@/lib/config";

export const metadata: Metadata = { title: "Contracts", description: "Heimdall contract addresses and roles on Robinhood Chain." };

export default function Page() {
  const link = (a?: string) => (a ? <a className="text-brand" href={explorerAddress(a)}>{a}</a> : "Published at launch");
  return (
    <>
      <H1 lead="All Heimdall contracts run on Robinhood Chain mainnet (chain ID 4663).">Contracts</H1>
      <H2 id="addresses">Addresses</H2>
      <Table head={["Contract", "Address"]} rows={[
        ["HeimdallVaultFactory", link(ADDRESSES.factory)],
        ["HeimdallSignals", link(ADDRESSES.signals)],
        ["$HEIM", link(ADDRESSES.heim)],
        ["USDG (Paxos)", link(ADDRESSES.usdg)],
      ]} />
      <H2 id="roles">Roles</H2>
      <Table head={["Role", "Who", "Can"]} rows={[
        ["Vault owner", "Heimdall multisig", "Pause; set targets, spenders, assets, feeds, Shield signer, manager, deposit cap."],
        ["Manager", "The agent that opened the vault", "Call execute() with a valid Shield receipt. Nothing else."],
        ["Shield signer", "Heimdall Shield (AWS KMS key)", "Sign receipts. Cannot move funds."],
        ["Depositor", "Anyone", "Deposit, withdraw, redeem in kind."],
        ["Signals owner", "Heimdall multisig", "Set treasury, fee (≤20%) and withdrawal delay (≤7 days)."],
      ]} />
    </>
  );
}
