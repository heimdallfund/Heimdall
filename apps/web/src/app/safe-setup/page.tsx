import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { AcceptOwnership } from "./AcceptOwnership";

export const metadata: Metadata = { title: "Admin Safe setup", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[680px] flex-col gap-6 px-6 pb-20 pt-10">
      <div className="flex flex-col gap-2.5">
        <h1 className="font-display text-[42px]">Admin Safe setup</h1>
        <p className="leading-relaxed text-muted">
          For the owner of the Heimdall admin Safe only. One transaction from the owner wallet makes the Safe accept ownership of
          the vault factory, Signals, Pay, Auto-Invest, Risk Oracle and Guard module. Nobody else can run it: the Safe only accepts
          it from its owner.
        </p>
      </div>
      <Providers><AcceptOwnership /></Providers>
    </div>
  );
}
