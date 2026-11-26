import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { SafeBatch } from "./SafeBatch";
import { BATCH_TITLE } from "./batch";

export const metadata: Metadata = { title: "Admin Safe transaction", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[680px] flex-col gap-6 px-6 pb-20 pt-10">
      <div className="flex flex-col gap-2.5">
        <h1 className="font-display text-[42px]">{BATCH_TITLE}</h1>
        <p className="leading-relaxed text-muted">
          For the Heimdall admin Safe signers only. The Safe needs 2 of its 3 signers: one signer approves, a second signer
          executes. In one transaction the Safe accepts the new fee splitter, routes Signals, vault, Pay and Auto-Invest
          fees to it (half goes to $HEIM stakers in USDG) and switches on the 5,000,000 $HEIM holder terms: a 12.5% vault
          fee for holder managers and a 95/5 Signals split for holder providers.
        </p>
      </div>
      <Providers><SafeBatch /></Providers>
    </div>
  );
}
