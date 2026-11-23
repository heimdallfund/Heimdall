import type { Metadata } from "next";
import Link from "next/link";
import { Code, H1, H2, Table, Note, C } from "@/components/docs/Docs";

export const metadata: Metadata = { title: "Webhooks", description: "Signed HTTPS events when Shield blocks one of your agents or a wallet you run gains a risky approval." };

export default function Page() {
  return (
    <>
      <H1 lead="Heimdall can POST to your server the moment Shield blocks one of your agents, or when a wallet you run picks up a risky approval. Every event is signed.">Webhooks</H1>
      <H2 id="setup">Set up</H2>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Open <Link className="text-brand" href="/app/keys">API keys & webhook</Link> and sign in with the wallet that owns your API keys.</li>
        <li>Enter an HTTPS endpoint, pick the events, and list up to 20 wallets to watch (usually your agents&apos; wallets).</li>
        <li>Copy the signing secret (<C>whsec_…</C>). It is shown once; <strong>New secret</strong> replaces it.</li>
        <li>Press <strong>Send test event</strong>. The last 20 deliveries are listed with their HTTP status.</li>
      </ol>
      <H2 id="events">Events</H2>
      <Table head={["Type", "When"]} rows={[
        [<C key="d">shield.deny</C>, "A transaction or signature check made with one of your API keys returned DENY."],
        [<C key="w">shield.warn</C>, "The same, for WARN."],
        [<C key="r">wallet.risky_approval</C>, "A watched wallet gained a new Danger or Review approval (checked every 15 minutes)."],
        [<C key="t">test</C>, "Sent by the Send test event button."],
      ]} />
      <H2 id="payload">Payload</H2>
      <p>A JSON body with an <C>id</C>, <C>type</C>, <C>createdAt</C> (UTC) and <C>data</C>. Headers: <C>heimdall-event</C>, <C>heimdall-delivery</C> and <C>heimdall-signature</C>.</p>
      <Code lang="json">{`{
  "id": "evt_Qm3x…",
  "type": "shield.deny",
  "createdAt": "2026-11-23T14:02:11.402Z",
  "data": {
    "kind": "tx",
    "checkId": "0x9f…",
    "verdict": "DENY",
    "riskScore": 95,
    "summary": ["Sends funds to a known drainer."],
    "findings": [{ "code": "BLOCKLISTED_TARGET", "severity": "deny", "message": "…" }],
    "chainId": 4663,
    "from": "0xYourAgent…",
    "to": "0xDrainer…",
    "value": "0",
    "apiKeyId": "a1b2c3d4e5f6"
  }
}`}</Code>
      <p><C>wallet.risky_approval</C> carries <C>wallet</C>, <C>approvals</C> (token, symbol, spender, risk, value at risk in USD) and <C>reportUrl</C>, the Wallet Check page where it can be revoked.</p>
      <H2 id="verify">Verify the signature</H2>
      <p><C>heimdall-signature</C> is <C>{"t=<unix seconds>,v1=<hex>"}</C>, where the hex is HMAC-SHA256 of <C>{"<t>.<raw body>"}</C> with your secret. Check it against the raw body before parsing, and reject events older than five minutes. The SDK does both:</p>
      <Code lang="ts">{`import { parseWebhook } from "@heimdallfund/sdk";

export async function POST(req: Request) {
  const body = await req.text(); // the raw body, not re-serialised JSON
  const event = await parseWebhook({ secret: process.env.HEIMDALL_WEBHOOK_SECRET!, body, signature: req.headers.get("heimdall-signature") });
  if (event.type === "shield.deny") await pauseAgent(event.data.from as string);
  return new Response("ok");
}`}</Code>
      <H2 id="delivery">Delivery rules</H2>
      <ul className="list-disc space-y-2 pl-5">
        <li>Answer with any 2xx within 5 seconds. Redirects are not followed.</li>
        <li>Events are sent once and not retried; use <C>id</C> to drop duplicates if you add your own retries.</li>
        <li>After 15 failed deliveries in a row the webhook is switched off. Saving it again switches it back on.</li>
        <li>Endpoints must be public HTTPS: localhost, private networks and credentials in the URL are refused.</li>
      </ul>
      <Note>Webhooks tell you what Shield saw; they do not replace the check itself. An agent should still refuse to sign anything Shield denied.</Note>
    </>
  );
}
