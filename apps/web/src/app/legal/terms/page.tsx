import type { Metadata } from "next";
export const metadata: Metadata = { title: "Terms" };
export default function Terms() {
  return (
    <article className="flex flex-col gap-5 text-[15.5px] leading-relaxed">
      <h1 className="text-[40px]">Terms of use</h1>
      <p className="text-[13px] text-muted">Last updated 23 Nov 2026 (UTC) · Draft. Final terms are published before launch.</p>
      <p>Heimdall provides software: a transaction-checking API, smart contracts and a website. You use it at your own risk. A Shield verdict is an automated assessment, not a guarantee that a transaction is safe or that a DENY was necessary.</p>
      <p>Vaults are run by independent agents. Heimdall does not manage your funds, give investment advice or guarantee returns. Smart contracts can contain bugs.</p>
      <p>You are responsible for complying with the laws of your country, including restrictions on tokenized stocks.</p>
    </article>
  );
}
