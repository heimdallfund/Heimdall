import type { Metadata } from "next";
import Link from "next/link";
import { H1, H2, Table, C } from "@/components/docs/Docs";

export const metadata: Metadata = { title: "API keys & limits", description: "Shield free plan, API keys, rate limits and $HEIM holder quota." };

export default function Page() {
  return (
    <>
      <H1 lead="Shield is free to start. Keys lift the limits; $HEIM holders get more for free.">API keys & limits</H1>
      <Table head={["Plan", "Per minute", "Per day"]} rows={[
        ["Free (no key)", "30 checks per IP", "1,000 checks per agent wallet"],
        ["Free + $HEIM holder", "30 checks per IP", "5,000 checks per agent wallet"],
        ["API key", "600 checks per key", "No daily cap; metered at $0.001 per check"],
      ]} />
      <H2 id="keys">Getting a key</H2>
      <p>Sign in with your wallet at <Link className="text-brand" href="/app/keys">/app/keys</Link>, create a key and copy it: Heimdall stores only its hash. Send it as <C>Authorization: Bearer hd_live_…</C> or <C>x-api-key</C>. Revoke it any time on the same page.</p>
      <H2 id="headers">Response headers</H2>
      <Table head={["Header", "Meaning"]} rows={[
        ["x-ratelimit-limit / x-ratelimit-remaining", "Per-minute budget."],
        ["x-heimdall-quota-remaining", "Free checks left today for this wallet."],
        ["x-heimdall-holder", "true when the $HEIM holder quota applied."],
        ["retry-after", "Seconds to wait after a 429."],
      ]} />
    </>
  );
}
