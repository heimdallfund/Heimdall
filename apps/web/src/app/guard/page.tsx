import type { Metadata } from "next";
import { ADDRESSES, explorerAddress } from "@/lib/config";
import { LaunchBanner } from "@/components/Preview";
import { CtaBand, Faq, SectionHead, Snippet, Steps } from "@/components/ProductSections";
import { SetupBuilder } from "./SetupBuilder";

export const metadata: Metadata = {
  title: "Heimdall Guard for Safe",
  description: "Give an AI agent a Safe wallet it can spend from, but only through Heimdall Shield and within daily limits you set. Your owners keep full control.",
};

const AGENT = `import { executeThroughGuard, HeimdallShield } from "@heimdallfund/sdk";

// Shield checks the call as the Safe, the module enforces your limits
const { hash } = await executeThroughGuard(agentWallet, {
  module: GUARD_MODULE,
  safe: "0xYourSafe",
  to: USDG,
  data: transferCalldata,
}, { shield: new HeimdallShield() });`;

const SETUP = `import { guardSetupCalls, safeBatch } from "@heimdallfund/sdk";

const calls = guardSetupCalls(safe, {
  module: GUARD_MODULE,
  agent: agentWallet,
  tokens: [{ token: USDG, perDay: 100_000_000n }], // 100 USDG a day
  strictTokens: true,
  expiresAt: BigInt(Date.now() / 1000 + 30 * 86_400),
});
writeFileSync("setup.json", JSON.stringify(safeBatch(4663, safe, calls)));`;

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-10 px-5 pb-20 pt-14 md:px-8">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">Heimdall Guard · Safe module</span>
        <h1 className="max-w-[860px] text-[50px] md:text-[68px]">Your agent gets a wallet. You keep the keys.</h1>
        <p className="max-w-[680px] text-[18px] leading-relaxed text-muted">Add one module to a Safe and an AI agent can spend from it, but only calls Shield approved, only up to the daily limits you set, and never on the Safe itself. The agent is not an owner: your owners can pause it, change its limits or remove it at any time.</p>
      </header>
      {ADDRESSES.guardModule ? <p className="font-mono text-[13px]">Module: <a className="text-brand hover:underline" href={explorerAddress(ADDRESSES.guardModule)}>{ADDRESSES.guardModule}</a></p> : <LaunchBanner>The Guard module goes live with the mainnet launch. It is tested against Safe 1.4.1, the version deployed on Robinhood Chain.</LaunchBanner>}
      <SetupBuilder module={ADDRESSES.guardModule} />
      <Steps title="Every agent call, three locks" steps={[
        ["receipt", "A fresh Shield receipt", "The agent asks Shield about the exact call, as the Safe. Only an ALLOW receipt for that calldata works, once, for 2 minutes."],
        ["gauge", "Your daily limits", "ETH and each token you list have a 24 h budget. Transfers and approvals both count; unlimited approvals are impossible."],
        ["lock", "Never the Safe itself", "The agent cannot add owners, enable modules, change its limits or delegatecall. Those stay with your owners."],
      ]} />
      <section className="flex flex-col gap-8">
        <SectionHead kicker="For developers" title="Two snippets" lead="Set it up from code, and run every agent action through it. Works with any agent framework the SDK supports." />
        <div className="grid gap-8 lg:grid-cols-2"><Snippet label="Agent · every call" code={AGENT} /><Snippet label="Setup · Safe batch" code={SETUP} /></div>
      </section>
      <Faq items={[
        ["What if the agent's key leaks?", "The thief still needs a Shield ALLOW receipt for each call, and can never spend more than one day's limit. Your owners pause the agent from the Safe with one transaction."],
        ["What if Heimdall's Shield signer leaks too?", "The daily limits still hold: they are enforced by the module, not by Shield. In tests, a hostile agent with every receipt granted never moved more than one day's budget."],
        ["Can Heimdall touch my Safe?", "No. Heimdall's multisig can only manage which Shield signers are trusted by default, and your Safe can pin its own signer instead. Your owners alone configure your agent."],
        ["Which Safe versions?", "Safe 1.4.1, the official deployment on Robinhood Chain. The module uses execTransactionFromModuleReturnData with CALL only."],
        ["Does it cost anything?", "The module is free. Shield checks follow the normal API plans: free tier, API key, or pay per call with x402."],
      ]} />
      <CtaBand title="Ship an agent wallet safely" text="Read the setup guide, or try Shield on a transaction first." primary={["/docs/guard", "Read the docs"]} secondary={["/app/shield", "Open the console"]} />
    </div>
  );
}
