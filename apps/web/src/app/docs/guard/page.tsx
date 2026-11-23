import type { Metadata } from "next";
import Link from "next/link";
import { H1, H2, Code, Table, C } from "@/components/docs/Docs";

export const metadata: Metadata = { title: "Guard for Safe", description: "A Safe module that lets an AI agent spend from a Safe only with a Shield receipt and within daily limits the owners set. The agent is never an owner." };

export default function Page() {
  return (
    <>
      <H1 lead={<>Heimdall Guard is a Safe module. Once a Safe enables it, an AI agent can spend from the Safe, but only:</>}>Guard for Safe</H1>
      <ul className="list-disc space-y-2 pl-5">
        <li>with a fresh Shield ALLOW receipt for that exact call, issued to the Safe,</li>
        <li>within 24-hour limits for ETH and for each token the owners list,</li>
        <li>never on the Safe itself or on the module, and always as a plain CALL (never DELEGATECALL).</li>
      </ul>
      <p>The agent never becomes an owner. The owners can pause it, change its limits, let it expire or remove it at any time with a normal Safe transaction. It is tested against Safe 1.4.1, the official deployment on Robinhood Chain.</p>
      <H2 id="set-it-up">Set it up</H2>
      <p>From the Safe, run these transactions (the setup page on heimdall.fund/guard builds the Transaction Builder file for you):</p>
      <Table head={["Call", "What it does"]} rows={[
        [<><C>{"safe.enableModule(module)"}</C></>, <>Lets the module act for this Safe</>],
        [<><C>{"module.setPolicy(ethPerDay, strictTokens, strictTargets)"}</C></>, <>ETH budget per 24 h; strict modes</>],
        [<><C>{"module.setTokenLimit(token, perDay, true)"}</C></>, <>A 24 h budget for a token (raw units)</>],
        [<><C>{"module.setTarget(contract, true)"}</C></>, <>Allow a contract when <C>{"strictTargets"}</C> is on</>],
        [<><C>{"module.setAgent(agent, true, expiresAt)"}</C></>, <>The agent&apos;s wallet, with an optional expiry</>],
      ]} />
      <p>With the SDK:</p>
      <Code lang="ts">{"import { guardSetupCalls, safeBatch } from \"@heimdallfund/sdk\";\n\nconst calls = guardSetupCalls(safe, {\n  module: GUARD_MODULE,\n  agent: agentWallet,\n  tokens: [{ token: USDG, perDay: 100_000_000n }], // 100 USDG a day\n  strictTokens: true,\n});\n// import this file in app.safe.global \u2192 Transaction Builder\nwriteFileSync(\"setup.json\", JSON.stringify(safeBatch(4663, safe, calls)));"}</Code>
      <H2 id="run-the-agent-through-it">Run the agent through it</H2>
      <Code lang="ts">{"import { executeThroughGuard, guardRemaining, HeimdallShield } from \"@heimdallfund/sdk\";\n\nawait executeThroughGuard(agentWallet, { module: GUARD_MODULE, safe, to: USDG, data }, { shield: new HeimdallShield() });\nconst left = await guardRemaining(publicClient, GUARD_MODULE, safe, USDG); // budget left today"}</Code>
      <p><C>{"executeThroughGuard"}</C> asks Shield about the call as the Safe, and throws <C>{"HeimdallDenied"}</C> on WARN or DENY, so nothing reaches the chain.</p>
      <H2 id="what-the-limits-count">What the limits count</H2>
      <ul className="list-disc space-y-2 pl-5">
        <li><strong>ETH:</strong> the <C>{"value"}</C> of every call.</li>
        <li><strong>A limited token:</strong> <C>{"transfer"}</C>, <C>{"approve"}</C>, <C>{"increaseAllowance"}</C>, and <C>{"transferFrom"}</C> out of the Safe. An approval counts like a transfer, so an unlimited approval of a limited token is impossible. <C>{"approve(spender, 0)"}</C> and <C>{"decreaseAllowance"}</C> are always allowed.</li>
        <li><strong>Anything else on a limited token</strong> (for example <C>{"transferAndCall"}</C> or <C>{"burn"}</C>) is refused, so a token can never move uncounted.</li>
        <li><strong>Strict tokens:</strong> token movements of tokens without a limit are refused. Recommended.</li>
        <li><strong>Strict targets:</strong> only listed contracts (and limited tokens) can be called.</li>
      </ul>
      <p>Windows are fixed 24-hour windows that start with the first spend after the last one ended.</p>
      <H2 id="who-can-do-what">Who can do what</H2>
      <Table head={["Who", "Can"]} rows={[
        [<>Safe owners</>, <>Everything: agents, limits, targets, pause, their own Shield signer, removing the module</>],
        [<>Agent</>, <><C>{"execute"}</C> within the rules above. Nothing else</>],
        [<>Heimdall multisig</>, <>Choose the default Shield signers. Nothing in any Safe</>],
        [<>A Safe</>, <>Pin its own receipt signer with <C>{"setSignerOverride"}</C> (for a self-hosted Shield)</>],
      ]} />
      <H2 id="security-notes">Security notes</H2>
      <ul className="list-disc space-y-2 pl-5">
        <li>If the agent key leaks, a thief still needs a Shield ALLOW receipt for each call and can move at most one day of budget.</li>
        <li>If the Shield signer also leaks, the limits still hold: they live in the module. In stateful tests, a hostile agent with every receipt granted never moved more than the budget.</li>
        <li>The module is reviewed in Heimdall&apos;s internal security review 4. It has not had an external audit yet.</li>
      </ul>
      <p>The module address is published at launch on the <Link className="text-brand" href="/docs/contracts">Contracts</Link> page.</p>
    </>
  );
}
