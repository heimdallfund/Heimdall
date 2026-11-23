import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { Faq } from "@/components/ProductSections";
import { IconTile } from "@/components/Icons";
import { FacetDivider } from "@/components/Motif";
import { WalletCheckForm } from "./WalletCheckForm";

export const metadata: Metadata = {
  title: "Wallet Check",
  description: "See every token approval your Robinhood Chain wallet has given, which ones a drainer could use, and revoke them in one click.",
};

export default function Page() {
  return (
    <div className="mx-auto max-w-[1120px] px-5 md:px-8">
      <section className="flex flex-col items-center gap-6 pb-14 pt-16 text-center md:pt-24">
        <span className="eyebrow">Wallet Check · free</span>
        <h1 className="max-w-[820px] text-[50px] md:text-[75px]">Who can still move your tokens?</h1>
        <p className="max-w-[620px] text-[18px] leading-relaxed text-muted">Every approval you ever gave stays live until you revoke it. Wallet Check finds them all, flags the ones a drainer could use, and lets you revoke them in one click.</p>
        <Providers><WalletCheckForm /></Providers>
      </section>
      <FacetDivider />
      <section className="grid gap-4 py-14 md:grid-cols-3">
        {([
          ["list", "Every approval", "Token approvals, Permit2 allowances and operator approvals, read live from Robinhood Chain."],
          ["alert", "Ranked by risk", "Approvals to plain wallets, blocklisted drainers and addresses Shield is denying come first, with the dollars they expose."],
          ["sparkle", "Revoke and earn", "Revoke from your own wallet. Each risky approval you remove earns 50 Guardian Points."],
        ] as const).map(([icon, t, d]) => (
          <div key={t} className="card flex flex-col gap-3 p-6"><IconTile name={icon} /><h2 className="text-[18px] font-semibold">{t}</h2><p className="text-[15px] leading-relaxed text-muted">{d}</p></div>
        ))}
      </section>
      <Faq items={[
        ["Does checking a wallet cost anything or need a signature?", "No. Checking is read-only and works for any address. Only revoking sends a transaction, from your own wallet."],
        ["What makes an approval dangerous?", "A spender that is a plain wallet instead of a contract, an address on the Heimdall blocklist, or one Shield has been denying. Unlimited approvals to contracts Heimdall does not recognise are marked for review."],
        ["Why does a scan sometimes take a little while?", "Older history is read in steps from the chain. Results appear right away and update as the scan finishes."],
        ["Is a clean result a guarantee?", "No. It means no live approvals were found. New signatures can still create new ones, so check what you sign with Shield."],
      ]} />
    </div>
  );
}
