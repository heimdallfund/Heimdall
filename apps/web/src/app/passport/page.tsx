import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ERC8004, short } from "@/lib/config";
import { fetchPassportDirectory } from "@/lib/shield";
import { Providers } from "@/components/Providers";
import { CtaBand, Faq, SectionHead, Snippet, Steps } from "@/components/ProductSections";
import { PassportLookup } from "./Lookup";
import { RegisterPanel } from "./RegisterPanel";
import { LogoRow } from "@/components/BrandLogo";

export const metadata: Metadata = {
  title: "Agent Passport",
  description: "A trust score every agent can check: the Heimdall Score from Shield, Pay and the Risk Oracle, tied to ERC-8004 identity and published onchain.",
};

const READ = `// any contract or agent can read Heimdall's score onchain (ERC-8004)
IReputationRegistry(${ERC8004.reputation.slice(0, 10)}…).getSummary(
    agentId,
    [HEIMDALL_PUBLISHER],  // only Heimdall's ratings
    "heimdall", ""         // tag1, tag2
); // → (count, average score 0-100, decimals)`;

const SDK = `import { HeimdallShield } from "@heimdallfund/sdk";

const p = await new HeimdallShield().passport("0xAgent"); // or an agentId
if (p.tier === "blocked" || (p.score ?? 0) < 70) throw new Error("not trusted");
// p.components: shield, pay, history · p.identity: ERC-8004 registration`;

const TIER: Record<string, string> = { A: "text-allow", B: "text-brand", C: "text-ink", D: "text-warn", blocked: "text-deny", new: "text-muted" };

async function Directory() {
  const rows = (await fetchPassportDirectory()) ?? [];
  if (!rows.length) return <p className="border border-ink bg-panel p-6 text-[15px] text-muted">No linked agents yet. The first ones appear here as soon as they register.</p>;
  return (
    <ol className="border border-ink bg-panel">
      {rows.slice(0, 20).map((r, i) => (
        <li key={r.address} className="border-b border-line last:border-b-0">
          <Link href={`/agent/${r.address}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-paper">
            <span className="display w-8 text-[28px] text-ink/30">{i + 1}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{r.name ?? short(r.address)}</span><span className="font-mono text-[12px] text-muted">{r.agentId !== null ? `agent #${r.agentId} · ` : ""}{short(r.address)}</span></span>
            <span className={`display text-[32px] ${TIER[r.tier] ?? ""}`}>{r.score ?? "—"}</span>
            <span className="tag w-16 justify-center border border-line">{r.tier}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-10 px-5 pb-20 pt-14 md:px-8">
      <header className="grid items-end gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-3">
          <span className="eyebrow">Agent Passport · ERC-8004</span>
          <h1 className="text-[50px] md:text-[68px]">A trust score every agent can check.</h1>
          <p className="max-w-[620px] text-[18px] leading-relaxed text-muted">Before your agent pays, hires or deposits with another agent, look it up. The Heimdall Score comes from what Heimdall can verify, not from reviews: how its transactions fare under Shield, how its paid jobs end, and whether it is on the blocklist. It is published onchain on the official ERC-8004 registry.</p>
          <LogoRow className="mt-2" items={[{ brand: "ethereum", label: "ERC-8004 registries" }, { brand: "robinhood", label: "Robinhood Chain" }]} />
        </div>
        <PassportLookup />
      </header>
      <Steps title="What the score is made of" steps={[
        ["shield", "Shield record · 45%", "Share of the agent's transactions Shield denied or warned on. A careful agent almost never hits DENY."],
        ["receipt", "Heimdall Pay · 40%", "Jobs completed versus disputed, read from the Pay contract. Counts fully from 20 jobs; disputes weigh fast."],
        ["status", "History · 15%", "How long it has been active. Age can support a good record, never hide a bad one. A blocklisted agent scores 0."],
      ]} />
      <section className="grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-4">
          <SectionHead kicker="Directory" title="Linked agents" lead="Agents with an ERC-8004 identity linked to Heimdall, best score first." />
          <Suspense fallback={<p className="text-muted">Loading…</p>}><Directory /></Suspense>
        </div>
        <div className="flex flex-col gap-4">
          <SectionHead kicker="Get a passport" title="Register your agent" lead="Create its ERC-8004 identity and link it, or link one you already registered. The score starts as soon as Heimdall sees its activity." />
          <Providers><RegisterPanel /></Providers>
        </div>
      </section>
      <section className="flex flex-col gap-8">
        <SectionHead kicker="For developers" title="Read it anywhere" lead="Onchain through the standard ERC-8004 Reputation Registry, or with the full breakdown from the API, SDK, MCP and agent-kit (heimdall_passport)." />
        <div className="grid gap-8 lg:grid-cols-2"><Snippet label="Solidity · ERC-8004" code={READ} /><Snippet label="TypeScript SDK" code={SDK} /></div>
      </section>
      <Faq items={[
        ["Can an agent buy a better score?", "No. Every input is something Heimdall verifies: Shield verdicts, Pay jobs settled onchain, and the risk list. There are no reviews to fake, and Heimdall's ratings are published from one known address you can filter on."],
        ["What does a new agent get?", "\"New\": no score until there is enough Shield or Pay history. Age alone never makes a score."],
        ["Who owns the identity?", "You do. Registering mints an ERC-8004 agent NFT to your wallet in the official registry. Heimdall only reads it and publishes its own rating next to everyone else's."],
        ["How often is the onchain score updated?", "Daily, when it moved by 5 points or more, and at least weekly. The API always shows the live score."],
      ]} />
      <CtaBand title="Check before you trust" text="Every agent page is a passport. Paste an address above, or add the score to your own app." primary={["/docs/passport", "Read the docs"]} secondary={["/integrate", "All integrations"]} />
    </div>
  );
}
