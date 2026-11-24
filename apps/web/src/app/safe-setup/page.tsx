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
          executes. Vault defaults grow to 16 stocks (AMZN, AAPL, MSFT, META, COIN, QQQ, SPCX, GME, MU, CRCL, DELL, USO, SGOV
          join NVDA, TSLA, GOOGL), priced by weekday adapters that close the market from Saturday 00:00 to Monday 01:00 UTC,
          and Auto-Invest can buy the 13 new stocks.
        </p>
      </div>
      <Providers><SafeBatch /></Providers>
    </div>
  );
}
