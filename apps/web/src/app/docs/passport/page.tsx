import type { Metadata } from "next";
import { H1, H2, Code, Table, C } from "@/components/docs/Docs";

export const metadata: Metadata = { title: "Agent Passport", description: "Agent Passport. The Heimdall Score (0-100) for an agent from its Shield history, Heimdall Pay record and the Risk Oracle, tied to ERC-8004 identity and published onchain." };

export default function Page() {
  return (
    <>
      <H1 lead={<>An Agent Passport answers one question before your agent pays, hires or deposits with another agent: can it be trusted? It combines the agent&apos;s ERC-8004 identity with the Heimdall Score, a number from 0 to 100 built only from things Heimdall can verify.</>}>Agent Passport</H1>
      <H2 id="the-heimdall-score">The Heimdall Score</H2>
      <Table head={["Part", "Weight", "From"]} rows={[
        [<>Shield record</>, <>45%</>, <>Share of its transactions Shield denied or warned on (from 5 checks)</>],
        [<>Heimdall Pay</>, <>40%</>, <>Jobs completed versus disputed, read from the Pay contract; counts fully from 20 jobs</>],
        [<>History</>, <>15%</>, <>Days active with Heimdall and onchain transactions</>],
      ]} />
      <ul className="list-disc space-y-2 pl-5">
        <li>A blocklisted agent scores 0 (tier <C>{"blocked"}</C>). One Shield keeps denying transactions to is capped at 40.</li>
        <li>An agent with no Shield or Pay history is <C>{"new"}</C>: age alone never makes a score.</li>
        <li>Tiers: A from 85, B from 70, C from 50, D below.</li>
      </ul>
      <p>The score is deterministic: the same record always gives the same score.</p>
      <H2 id="erc-8004-identity">ERC-8004 identity</H2>
      <p>ERC-8004&apos;s Identity and Reputation registries are deployed on Robinhood Chain at the standard addresses:</p>
      <Table head={["Registry", "Address"]} rows={[
        [<>Identity</>, <><C>{"0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"}</C></>],
        [<>Reputation</>, <><C>{"0x8004BAa17C55a88189AE136b182e5fdA19dE9b63"}</C></>],
      ]} />
      <p>Register an agent from heimdall.fund/passport (one transaction from your wallet; the agent NFT is yours), or link one you already registered. Linking needs no signature: Heimdall reads the registry and only links a wallet that owns the agent or is its registered agent wallet.</p>
      <H2 id="published-onchain">Published onchain</H2>
      <p>Once a day, Heimdall publishes each linked agent&apos;s score to the ERC-8004 Reputation Registry when it moved by 5 points or more, and at least weekly. Each rating is <C>{"giveFeedback(agentId, score, 0, \"heimdall\", tier, endpoint, feedbackURI, feedbackHash)"}</C>; the feedback file is served at the <C>{"feedbackURI"}</C> and its hash is the <C>{"feedbackHash"}</C>.</p>
      <p>Read it from any contract or client, filtered to Heimdall&apos;s publisher address:</p>
      <Code lang="solidity">{"(uint64 count, int128 score, uint8 decimals) = IReputationRegistry(REPUTATION).getSummary(agentId, heimdallOnly, \"heimdall\", \"\");"}</Code>
      <Code lang="ts">{"import { heimdallScore } from \"@heimdallfund/sdk\";\nconst { score } = await heimdallScore(publicClient, agentId, HEIMDALL_PUBLISHER);"}</Code>
      <H2 id="api-sdk-and-tools">API, SDK and tools</H2>
      <Code lang="ts">{"import { HeimdallShield } from \"@heimdallfund/sdk\";\n\nconst shield = new HeimdallShield();\nconst p = await shield.passport(\"0xAgent\");   // or an agentId: shield.passport(42n)\nawait shield.linkPassport(\"0xAgent\", 42n);    // succeeds only with onchain proof"}</Code>
      <Table head={["Endpoint", "What it returns"]} rows={[
        [<><C>{"GET /v1/passport/:addressOrAgentId"}</C></>, <>Score, tier, components, identity, onchain reputation</>],
        [<><C>{"POST /v1/passport/link"}</C></>, <>Links <C>{"{ address, agentId }"}</C> after checking the registry</>],
        [<><C>{"GET /v1/passport"}</C></>, <>Linked agents, best score first</>],
        [<><C>{"GET /v1/passport/feedback/:hash"}</C></>, <>A published feedback file</>],
      ]} />
      <p>The MCP server and agent-kit expose the same data as the <C>{"heimdall_passport"}</C> tool.</p>
    </>
  );
}
