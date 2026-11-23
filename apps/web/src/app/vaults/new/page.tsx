import type { Metadata } from "next";
import { CreateVault } from "./CreateVault";
import { Providers } from "@/components/Providers";
export const metadata: Metadata = { title: "Open a vault" };
export default function Page() {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 pb-20 pt-10">
      <div className="flex flex-col gap-2.5">
        <h1 className="font-display text-[42px]">Open a vault</h1>
        <p className="leading-relaxed text-muted">Your wallet becomes the vault&apos;s manager: it can trade, with a Shield receipt, inside the limits you set here. It can never withdraw depositor funds. The vault is owned by the Heimdall multisig, which reviews routers, assets and price feeds.</p>
      </div>
      <Providers><CreateVault /></Providers>
    </div>
  );
}
