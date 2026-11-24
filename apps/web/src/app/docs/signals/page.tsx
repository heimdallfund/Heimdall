import type { Metadata } from "next";
import Link from "next/link";
import { Code, H1, H2, Table, Note, C } from "@/components/docs/Docs";

export const metadata: Metadata = { title: "Signals", description: "Pay-per-call market signals for agents, settled in USDG on Robinhood Chain with gasless EIP-712 vouchers." };

export default function Page() {
  return (
    <>
      <H1 lead="A marketplace where agents pay per answer in USDG. No subscriptions, no API contracts.">Signals</H1>
      <H2 id="agents">Paying as an agent</H2>
      <p>Two ways to pay. <strong>Direct</strong>: call <C>pay(signalId, calls, requestId, maxPricePerCall)</C> and send the transaction hash to the provider. <strong>Vouchers</strong> (recommended): prefund once, then sign a voucher per call, offchain and without gas.</p>
      <Code lang="ts">{`import { signVoucher, encodeVoucherHeader } from "@heimdallfund/sdk";

// once: USDG.approve(signals, amount) then signals.fund(amount)
spent += price;                                  // keep a running total per signal
const v = await signVoucher(agent, { chainId: 4663, signals, signalId, cumulativeAmount: spent });
const res = await fetch(endpoint, { headers: { "x-heimdall-voucher": encodeVoucherHeader(v) } });`}</Code>
      <p>Vouchers are <em>cumulative</em>: each one states the total you have ever agreed to pay this signal, so a provider can only ever claim the difference once. Withdrawing a prefunded balance takes <C>requestWithdraw</C>, then <C>withdraw</C> between 24 hours and 4 days later, so vouchers you already gave stay payable. A pending withdrawal stops counting toward <C>available(payer)</C> right away, which is what providers check.</p>
      <H2 id="providers">Selling as a provider</H2>
      <ol className="list-decimal space-y-2 pl-5">
        <li>List the signal at <Link className="text-brand" href="/signals/new">/signals/new</Link> or call <C>register(uri, pricePerCall, payout)</C>. The <C>uri</C> is JSON: name, category, description, endpoint.</li>
        <li>Put the voucher gate in front of your endpoint. Unpaid requests get <C>402 Payment Required</C> with payment instructions; charge only after you answered.</li>
        <li>Redeem the latest voucher per payer whenever you like with <C>redeem(voucher, signature)</C>.</li>
      </ol>
      <Code lang="ts">{`import { gateVoucher, MemoryLedger } from "@heimdallfund/sdk";

const ledger = new MemoryLedger(); // use a shared store (e.g. Redis) in production
app.get("/my-signal", async (c) => {
  const gate = await gateVoucher({ chainId: 4663, signals, signalId: 7n, pricePerCall: 20_000n, client, ledger }, c.req.header("x-heimdall-voucher"));
  if (!gate.ok) return c.json(gate.body, gate.status);   // 402 with how to pay
  const answer = await compute();
  if (!(await gate.commit())) return c.json({ error: "voucher_conflict" }, 409);
  return c.json(answer);
});`}</Code>
      <H2 id="official">Official Heimdall signals</H2>
      <Table head={["Endpoint", "What", "Price"]} rows={[
        ["/v1/token-risk?token=0x…", "Contract checks, upgradeable proxy, owner powers (mint, pause, blacklist, fees), blocklist → score 0–100", "$0.02"],
        ["/v1/address-intel?address=0x…", "EOA, contract or EIP-7702 delegate; activity; ETH and USDG balance; blocklist", "$0.01"],
        ["/v1/stock-premium?symbol=NVDA", "Onchain stock token price vs exchange price, as a premium in bps", "$0.05"],
      ]} />
      <Note>Every payment splits 90% to the provider and 10% to the Heimdall treasury (capped at 20% onchain). If the payout wallet holds at least 5,000,000 $HEIM, the split is 95/5.</Note>
    </>
  );
}
