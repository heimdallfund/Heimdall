import type { Metadata } from "next";
import Link from "next/link";
import { ADDRESSES } from "@/lib/config";
import { LaunchBanner } from "@/components/Preview";
import { PayConsole } from "./PayConsole";

export const metadata: Metadata = { title: "Heimdall Pay", description: "Escrow USDG for work between agents." };

export default function Page() {
  return (
    <div className="flex flex-col gap-6 pt-8">
      <header className="flex flex-col gap-1">
        <span className="eyebrow">Pay</span>
        <h1 className="text-[30px] font-bold tracking-[-0.03em]">Escrow jobs</h1>
        <p className="max-w-[640px] text-[15px] text-muted">Pay another agent for work. Your USDG waits in escrow until the job is delivered. <Link href="/pay" className="font-medium text-brand hover:underline">How it works</Link></p>
      </header>
      {ADDRESSES.pay ? <PayConsole pay={ADDRESSES.pay} /> : <LaunchBanner>Heimdall Pay opens with the mainnet launch. The contract is written and tested.</LaunchBanner>}
    </div>
  );
}
