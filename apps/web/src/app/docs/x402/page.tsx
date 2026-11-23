import type { Metadata } from "next";
import { H1, H2, Code, Table, C } from "@/components/docs/Docs";

export const metadata: Metadata = { title: "x402 payments", description: "Pay Heimdall per call in USDG with x402, no API key. Use Heimdall's x402 facilitator on Robinhood Chain, which checks every recipient with Shield before it settles." };

export default function Page() {
  return (
    <>
      <H1 lead={<>x402 lets an HTTP API ask for a payment with a <C>{"402 Payment Required"}</C> answer, and lets the client pay with a signature. On Robinhood Chain, Heimdall uses USDG with EIP-3009 (<C>{"transferWithAuthorization"}</C>): the payer signs, the facilitator submits the transfer and pays the gas.</>}>x402 payments</H1>
      <Table head={["Setting", "Value"]} rows={[
        [<>Network</>, <><C>{"eip155:4663"}</C> (v1: <C>{"robinhood"}</C>)</>],
        [<>Asset</>, <>USDG <C>{"0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"}</C>, 6 decimals</>],
        [<>Signing domain</>, <>name <C>{"Global Dollar"}</C>, version <C>{"1"}</C></>],
        [<>Scheme</>, <><C>{"exact"}</C> (the payment equals the price)</>],
      ]} />
      <H2 id="pay-for-shield">Pay for Shield</H2>
      <p>The free tier works as before. When it is used up, instead of <C>{"429 Too Many Requests"}</C> Shield answers <C>{"402"}</C> with a <C>{"PAYMENT-REQUIRED"}</C> header. Pay and retry with <C>{"PAYMENT-SIGNATURE"}</C>:</p>
      <Table head={["Endpoint", "Price"]} rows={[
        [<><C>{"POST /v1/check"}</C></>, <>0.001 USDG</>],
        [<><C>{"POST /v1/check-signature"}</C></>, <>0.001 USDG</>],
        [<><C>{"GET /v1/wallet/:address"}</C></>, <>0.002 USDG</>],
      ]} />
      <Code lang="ts">{"import { payX402, HeimdallShield } from \"@heimdallfund/sdk\";\n\n// pays only when asked, never above 0.01 USDG per call; the wallet needs USDG, not ETH\nconst shield = new HeimdallShield({ fetch: payX402(fetch, agentWallet, { maxAmount: 10_000n }) });"}</Code>
      <p>MCP: set <C>{"HEIMDALL_X402_PRIVATE_KEY"}</C> (a wallet holding USDG) and optionally <C>{"HEIMDALL_X402_MAX"}</C> (raw units per call, default 5000).</p>
      <p>One payment buys one call. Shield refuses a replayed payment header, and validates the request body before charging, so a malformed request is never paid for.</p>
      <H2 id="use-the-facilitator-for-your-api">Use the facilitator for your API</H2>
      <p>Heimdall runs a standard x402 v2 facilitator for Robinhood Chain:</p>
      <Table head={["Endpoint", "What it does"]} rows={[
        [<><C>{"GET /x402/supported"}</C></>, <>Networks, schemes and the settling address</>],
        [<><C>{"POST /x402/verify"}</C></>, <>Checks a payment and moves nothing</>],
        [<><C>{"POST /x402/settle"}</C></>, <>Verifies again, settles onchain, waits for the receipt</>],
        [<><C>{"GET /discovery/resources"}</C></>, <>Paid APIs that asked to be listed (Bazaar)</>],
      ]} />
      <p><C>{"/verify"}</C> and <C>{"/settle"}</C> take <C>{"{ x402Version, paymentPayload, paymentRequirements }"}</C> and answer the standard <C>{"VerifyResponse"}</C> and <C>{"SettlementResponse"}</C>.</p>
      <Code lang="ts">{"const r = await fetch(\"https://api.heimdall.fund/x402/settle\", {\n  method: \"POST\",\n  headers: { \"content-type\": \"application/json\" },\n  body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements }),\n}).then((r) => r.json()); // { success, transaction, payer, network }"}</Code>
      <p>What the facilitator checks, in order: version, scheme, network and asset; that <C>{"to"}</C> is your <C>{"payTo"}</C>; that the value equals the price; the validity window; the signature (EOA or smart wallet); <strong>that the recipient is not on Heimdall&apos;s blocklist</strong> (<C>{"heimdall_recipient_blocked"}</C>); the payer&apos;s balance; and that the nonce is unused. Settlement is idempotent per payer and nonce.</p>
      <p>Limits: payments under 0.001 USDG are not settled, and <C>{"/settle"}</C> is rate-limited per IP. Payments are settled from Heimdall&apos;s facilitator wallet, which never holds USDG.</p>
      <H2 id="get-listed">Get listed</H2>
      <p>Add the Bazaar extension to your <C>{"PAYMENT-REQUIRED"}</C> object (<C>{"extensions.bazaar"}</C>) and include <C>{"resource"}</C> in the payment payload. After the first payment settles through Heimdall, the endpoint appears in <C>{"GET /discovery/resources"}</C>, which directories crawl.</p>
    </>
  );
}
