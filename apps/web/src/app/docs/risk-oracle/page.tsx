import type { Metadata } from "next";
import Link from "next/link";
import { H1, H2, Code, Table, C } from "@/components/docs/Docs";

export const metadata: Metadata = { title: "Risk Oracle", description: "Onchain risk data for Robinhood Chain that any contract can read in one call. Drainers, phishing contracts, exploiters and honeypots, kept current by Heimdall." };

export default function Page() {
  return (
    <>
      <H1 lead={<>The Heimdall Risk Oracle is a contract on Robinhood Chain that holds a risk level for known-bad addresses: drainers, phishing contracts, exploiters and honeypot tokens. Any contract reads it with one view call, for free.</>}>Risk Oracle</H1>
      <H2 id="levels-and-flags">Levels and flags</H2>
      <Table head={["Level", "Name", "Meaning"]} rows={[
        [<>0</>, <>none</>, <>No data. Not a guarantee: check the transaction itself with Shield.</>],
        [<>1</>, <>low</>, <>Seen in a risky pattern.</>],
        [<>2</>, <>warn</>, <>Shield denied 5 or more transactions to it this week. Review before trusting.</>],
        [<>3</>, <>blocked</>, <>Drainer, phishing, exploiter or honeypot, on Heimdall&apos;s blocklist. Refuse.</>],
      ]} />
      <p>Flags are bits, and an entry can carry several: <C>{"DRAINER"}</C> (1), <C>{"PHISHING"}</C> (2), <C>{"HONEYPOT"}</C> (4), <C>{"MALICIOUS_CONTRACT"}</C> (8), <C>{"SCAM_TOKEN"}</C> (16), <C>{"EXPLOITER"}</C> (32), <C>{"COMMUNITY"}</C> (64, confirmed from a community report), <C>{"SHIELD_DENIED"}</C> (128).</p>
      <H2 id="read-it-from-a-contract">Read it from a contract</H2>
      <p>Copy <C>{"IHeimdallRisk.sol"}</C> and <C>{"HeimdallRiskAware.sol"}</C> from the Heimdall contracts (MIT), then add the modifier to any function:</p>
      <Code lang="solidity">{"contract MyLaunchpad is HeimdallRiskAware {\n    constructor(IHeimdallRisk oracle) HeimdallRiskAware(oracle, false) {}\n\n    function buy(address to) external notBlocked(msg.sender) notBlocked(to) {\n        // blocked addresses never get here\n    }\n}"}</Code>
      <p><C>{"HeimdallRiskAware"}</C> reads the oracle with a gas-capped static call and never reverts on its own. The second constructor argument picks what happens if the oracle cannot be read: <C>{"false"}</C> lets the call through (most apps), <C>{"true"}</C> blocks it (for flows where an unchecked address is worse than a pause).</p>
      <p>Direct reads:</p>
      <Code lang="solidity">{"IHeimdallRisk(oracle).isBlocked(recipient);            // bool\nIHeimdallRisk(oracle).riskOf(addr);                    // (uint8 level, uint32 flags, uint64 updatedAt)\nIHeimdallRisk(oracle).anyBlocked(addresses);           // one call for a whole route"}</Code>
      <H2 id="read-it-offchain">Read it offchain</H2>
      <Code lang="ts">{"import { readRisk, HeimdallShield } from \"@heimdallfund/sdk\";\n\nconst onchain = await readRisk(publicClient, ORACLE, \"0x\u2026\"); // { level, levelName, flags, blocked }\nconst full = await new HeimdallShield().risk(\"0x\u2026\");          // plus the reason and what Shield knows"}</Code>
      <p>The HTTP API answers without a key: <C>{"GET /v1/risk/:address"}</C> for one address, <C>{"GET /v1/risk"}</C> for the whole list. The MCP server and agent-kit have the same lookup as the <C>{"heimdall_risk"}</C> tool.</p>
      <H2 id="how-it-stays-current">How it stays current</H2>
      <ul className="list-disc space-y-2 pl-5">
        <li>Shield&apos;s risk list is built from Heimdall&apos;s curated blocklist, confirmed community reports, and addresses Shield keeps denying.</li>
        <li>Every 10 minutes the monitor compares that list with the oracle and writes the differences in batches of up to 200: new entries, changed flags and cleared entries. Each write is a <C>{"RiskSet"}</C> event.</li>
        <li>Only reporters approved by the Heimdall multisig can write, and only levels and flags.</li>
      </ul>
      <H2 id="mistakes-and-appeals">Mistakes and appeals</H2>
      <p>The multisig can pin an entry: set its level and lock it so reporters cannot change it. A false positive is cleared by pinning the address at level 0. Report one to security@heimdall.fund with the address and why it is safe.</p>
      <H2 id="address">Address</H2>
      <p>The oracle address is published at launch on the <Link className="text-brand" href="/docs/contracts">Contracts</Link> page and on heimdall.fund/oracle.</p>
    </>
  );
}
