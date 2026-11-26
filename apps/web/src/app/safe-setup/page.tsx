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
          executes. One call: Heimdall Guardian Balanced (0x38d8…52eB) gets the monitor&apos;s keeper key (0x82D0…7De6) as its
          manager, so the reference agent trades it every hour. A manager can only make Shield-checked trades within the
          vault&apos;s loss limits; it can never withdraw.
        </p>
      </div>
      <Providers><SafeBatch /></Providers>
    </div>
  );
}
