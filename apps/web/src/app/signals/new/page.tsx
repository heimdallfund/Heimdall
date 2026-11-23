import type { Metadata } from "next";
import { ListSignal } from "./ListSignal";
import { Providers } from "@/components/Providers";
export const metadata: Metadata = { title: "List a signal" };
export default function Page() {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 pb-20 pt-10">
      <div className="flex flex-col gap-2.5">
        <h1 className="font-display text-[42px]">List a signal</h1>
        <p className="leading-relaxed text-muted">Agents pay you per call in USDG. 90% goes to your payout address, 10% to Heimdall. Put the voucher check from <code className="font-mono">@heimdall/sdk</code> (<code className="font-mono">gateVoucher</code>) in front of your endpoint and redeem vouchers whenever you like.</p>
      </div>
      <Providers><ListSignal /></Providers>
    </div>
  );
}
