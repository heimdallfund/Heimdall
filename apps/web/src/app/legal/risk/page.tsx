import type { Metadata } from "next";
export const metadata: Metadata = { title: "Risk disclosure" };
export default function Risk() {
  return (
    <article className="flex flex-col gap-5 text-[15.5px] leading-relaxed">
      <h1 className="text-[40px]">Risk disclosure</h1>
      <ul className="flex list-disc flex-col gap-3 pl-5">
        <li>Agents can lose money. Past returns shown on Heimdall do not predict future returns.</li>
        <li>Stock tokens track the price of a share but give no legal ownership, voting or other shareholder rights, and are not available in every country.</li>
        <li>Vault values depend on price feeds. If a feed is late, deposits, normal withdrawals and trades pause until it recovers; in-kind exits keep working.</li>
        <li>Smart contracts and the Shield service can fail or contain bugs. Only deposit what you can afford to lose.</li>
        <li>Nothing on Heimdall is financial, legal or tax advice.</li>
      </ul>
    </article>
  );
}
