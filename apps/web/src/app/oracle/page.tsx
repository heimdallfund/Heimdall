import type { Metadata } from "next";
import Link from "next/link";
import { ADDRESSES, explorerAddress } from "@/lib/config";
import { fetchRiskList } from "@/lib/shield";
import { LaunchBanner } from "@/components/Preview";
import { CtaBand, Faq, SectionHead, Snippet, Steps } from "@/components/ProductSections";
import { RiskLookup } from "./RiskLookup";
import { LogoRow } from "@/components/BrandLogo";

export const metadata: Metadata = {
  title: "Risk Oracle",
  description: "Onchain risk data for Robinhood Chain: drainers, phishing contracts, exploiters and honeypots, readable by any contract in one call. Free.",
};

const SOLIDITY = `// copy HeimdallRiskAware.sol and IHeimdallRisk.sol from the docs (MIT)
import {HeimdallRiskAware, IHeimdallRisk} from "./HeimdallRiskAware.sol";

contract MyLaunchpad is HeimdallRiskAware {
    constructor(IHeimdallRisk oracle) HeimdallRiskAware(oracle, false) {}

    function buy(address to) external notBlocked(msg.sender) notBlocked(to) {
        // drainers and exploiters never get here
    }
}`;

const READ = `// any language, any contract: one view call
IHeimdallRisk(oracle).isBlocked(recipient);            // true / false
IHeimdallRisk(oracle).riskOf(addr);                    // (level, flags, updatedAt)
IHeimdallRisk(oracle).anyBlocked([from, to, spender]); // one call for a whole route`;

const TS = `import { readRisk } from "@heimdallfund/sdk";

const r = await readRisk(publicClient, ORACLE, "0x…");
if (r.blocked) throw new Error(\`refusing: \${r.flags.join(", ")}\`);`;

async function Count() {
  const list = await fetchRiskList();
  if (!list) return null;
  const blocked = list.entries.filter((e) => e.level >= 3).length;
  return <p className="font-mono text-[12px] uppercase tracking-[0.1em] text-muted">{list.count} addresses on the list · {blocked} blocked</p>;
}

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-10 px-5 pb-20 pt-14 md:px-8">
      <header className="grid items-end gap-8 lg:grid-cols-[1.1fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-3">
          <span className="eyebrow">Risk Oracle · free for every contract</span>
          <h1 className="text-[50px] md:text-[68px]">One call to keep drainers out.</h1>
          <p className="max-w-[600px] text-[18px] leading-relaxed text-muted">Heimdall writes what Shield learns onchain: drainers, phishing contracts, exploiters and honeypot tokens on Robinhood Chain. Your DEX, launchpad, bridge or wallet reads it in one view call and stops them before they touch your users.</p>
          <LogoRow items={[{ brand: "robinhood", label: "Robinhood Chain" }, { brand: "uniswap", label: "For DEXs" }, { brand: "safe", label: "For wallets and Safes" }]} />
          <Count />
        </div>
        <RiskLookup />
      </header>
      {!ADDRESSES.riskOracle && <LaunchBanner>The Risk Oracle contract goes live with the mainnet launch. The lookup above already answers from Shield&apos;s list.</LaunchBanner>}
      {ADDRESSES.riskOracle && <p className="font-mono text-[13px]">Oracle: <a className="text-brand hover:underline" href={explorerAddress(ADDRESSES.riskOracle)}>{ADDRESSES.riskOracle}</a></p>}
      <Steps title="From a denied check to an onchain flag" steps={[
        ["shield", "Shield sees it", "Every transaction and signature Shield judges, plus confirmed community reports, feeds Heimdall's risk list."],
        ["layers", "Synced onchain", "Every 10 minutes the list is written to the oracle in batches: new flags, changed flags and cleared ones."],
        ["lock", "You read it free", "isBlocked(address) is a plain view call. No API key, no fee, no oracle network to pay."],
      ]} />
      <section className="flex flex-col gap-8">
        <SectionHead kicker="Integrate" title="Three ways to use it" lead="Add a modifier to your contract, call the oracle from anywhere, or read it offchain from your backend or agent." />
        <div className="grid gap-8 lg:grid-cols-2">
          <Snippet label="Solidity · modifier" code={SOLIDITY} />
          <div className="flex min-w-0 flex-col gap-8"><Snippet label="Solidity · direct read" code={READ} /><Snippet label="TypeScript · SDK" code={TS} /></div>
        </div>
      </section>
      <section className="grid gap-px border border-ink bg-ink sm:grid-cols-2 lg:grid-cols-4">
        {[["0", "None", "No data. Not a guarantee: check the transaction itself."], ["1", "Low", "Seen in a risky pattern."], ["2", "Warn", "Shield keeps denying transactions to it. Review first."], ["3", "Blocked", "Drainer, phishing, exploiter or honeypot. Refuse."]].map(([n, t, d]) => (
          <div key={n} className="flex flex-col gap-2 bg-panel p-5"><span className={`display text-[44px] ${n === "3" ? "text-deny" : n === "2" ? "text-warn" : ""}`}>{n}</span><span className="label text-ink">{t}</span><span className="text-[14px] text-muted">{d}</span></div>
        ))}
      </section>
      <Faq items={[
        ["What does it cost?", "Nothing. Reading the oracle is a view call. Heimdall pays the gas to keep it current."],
        ["What if Heimdall gets one wrong?", "Clearing a flag is a Safe transaction: the multisig pins the address as clean, and the sync job can never flag it again. Report a mistake to security@heimdall.fund."],
        ["What if the oracle is down or never deployed?", "HeimdallRiskAware reads it with a gas cap and never reverts. You choose: fail open (most apps) or fail closed (when an unchecked address is worse than a pause)."],
        ["Who can write to it?", "Only reporters the Heimdall multisig approves, and only levels and flags. They cannot move funds or touch any other contract. Every change is an onchain event."],
        ["Is the list public?", "Yes. GET /v1/risk returns the whole list, and every write is a RiskSet event you can index."],
      ]} />
      <CtaBand title="Protect your users today" text="The lookup and the list work now. The contract address is published at launch on the Contracts page." primary={["/docs/risk-oracle", "Read the docs"]} secondary={["/integrate", "All integrations"]} />
      <p className="text-[13px] text-muted">See also: <Link href="/threats" className="text-brand hover:underline">Threat Board</Link> · <Link href="/check" className="text-brand hover:underline">Wallet Check</Link></p>
    </div>
  );
}
