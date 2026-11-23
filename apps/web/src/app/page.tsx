import Link from "next/link";
import { Suspense } from "react";
import { Icon, type IconName } from "@/components/Icons";
import { Reveal } from "@/components/Reveal";
import { CountUp } from "@/components/motion/Text";
import { AudienceTabs, type Audience } from "@/components/home/AudienceTabs";
import { HeroCheck } from "@/components/home/HeroCheck";
import { Checkpoint } from "@/components/home/Checkpoint";
import { CheckFlow } from "@/components/home/CheckFlow";
import { FeeCalc } from "@/components/home/FeeCalc";
import { ShieldVisual, SignalsVisual, VaultVisual } from "@/components/Visuals";
import { getShieldStats, getSignals, getVaults } from "@/lib/reads";

function Stat({ label, value, suffix = "", tone }: { label: string; value: number | null; suffix?: string; tone?: string }) {
  return (
    <div className="bg-panel px-5 py-5 text-left sm:px-6">
      <div className="label">{label}</div>
      <div className={`display mt-3 text-[44px] ${tone ?? ""}`}>{value === null ? "—" : <CountUp to={value} suffix={suffix} />}</div>
    </div>
  );
}

async function Metrics() {
  const [stats, vaults, signals] = await Promise.all([getShieldStats(), getVaults(), getSignals()]);
  const live = (stats?.checks ?? 0) > 0 || vaults.length > 0 || signals.length > 0;
  if (!live) {
    return (
      <>
        <Stat label="Open security findings" value={0} tone="text-allow" />
        <Stat label="Max vault loss per day" value={5} suffix="%" />
        <Stat label="Receipt lifetime (s)" value={120} />
        <Stat label="Contract tests" value={112} />
      </>
    );
  }
  return (
    <>
      <Stat label="Shield checks" value={stats?.checks ?? null} />
      <Stat label="Transactions denied" value={stats?.denied ?? null} tone="text-deny" />
      <Stat label="Vaults" value={vaults.length} />
      <Stat label="Signals listed" value={signals.length} />
    </>
  );
}

const audiences: Audience[] = [
  { id: "agents", label: "Agent builders", title: "Give your agent a firewall before it touches funds.", text: "Send every transaction and signature request to Shield first. It simulates the call on live Robinhood Chain state and tells your agent, in plain words, whether to sign.", points: ["Catches drainers, honeypots and unlimited approvals", "Per-agent policy: spend caps, allow lists, strict mode", "REST API, TypeScript SDK and MCP server"], cta: ["/shield", "Explore Shield"], visual: <ShieldVisual /> },
  { id: "depositors", label: "Depositors", title: "Put USDG to work with agents that cannot take it.", text: "Deposit into tokenized-stock vaults run by AI agents. The vault contract only lets the manager trade through Shield, inside hard loss limits, and you can always exit.", points: ["Managers can never withdraw your funds", "≤3% loss per trade, ≤5% of NAV per day", "Fees only on new profit; exit in kind any time"], cta: ["/vaults", "Explore vaults"], visual: <VaultVisual /> },
  { id: "providers", label: "Signal providers", title: "Sell what your models know, one call at a time.", text: "List an endpoint, set a price per call in USDG, and let agents pay with gasless vouchers. No subscriptions, no invoicing, settled onchain.", points: ["HTTP 402 payments with signed vouchers", "Keep 90% of every call (95% as a $HEIM holder)", "Listing takes one transaction"], cta: ["/signals", "Explore Signals"], visual: <SignalsVisual /> },
];

const products: { icon: IconName; name: string; tag: string; d: string; href: string }[] = [
  { icon: "shield", name: "Shield", tag: "Transaction firewall", d: "Simulates every transaction and signature and answers ALLOW, WARN or DENY before your agent signs.", href: "/shield" },
  { icon: "search", name: "Wallet Check", tag: "Approvals & alerts", d: "Finds risky approvals in any wallet, revokes them in one click and watches for new ones.", href: "/check" },
  { icon: "vault", name: "Vaults", tag: "Guarded stock vaults", d: "Tokenized-stock vaults whose AI manager can trade only through Shield and can never withdraw.", href: "/vaults" },
  { icon: "signal", name: "Signals", tag: "Pay-per-call data", d: "Agents buy market and risk signals per call in USDG with gasless vouchers.", href: "/signals" },
  { icon: "check", name: "Pay", tag: "Escrow for agent jobs", d: "The money waits for the work: USDG escrow with deadlines, review windows and arbiters.", href: "/pay" },
  { icon: "arrow", name: "Auto-Invest", tag: "Recurring stock buys", d: "Buy NVDA, TSLA or GOOGL on a schedule from your own wallet, inside a Chainlink price bound.", href: "/invest" },
];

const compare: [string, string, string][] = [
  ["Manager can move depositor funds out", "Often possible", "Impossible: calls are allowlisted"],
  ["Every trade checked before it executes", "No", "Shield receipt required onchain"],
  ["Loss limit per trade", "Rare", "≤3%, checked with oracle prices"],
  ["Loss limit per day", "No", "≤5% of NAV per 24 hours"],
  ["Exit while paused or a feed is down", "Usually blocked", "Redeem in kind, always"],
  ["Fees", "Management + performance", "15% of new profit only"],
  ["Pre-launch security review", "Varies", "10 serious & medium findings, all fixed"],
];

const faq: [string, string][] = [
  ["What does Heimdall check?", "Every transaction and signature request your agent is about to sign. Shield simulates it on the latest Robinhood Chain block, lists every asset that would move and every approval, and returns ALLOW, WARN or DENY with reasons."],
  ["Can a vault manager take my money?", "No. The vault contract only lets the manager call reviewed swap functions with a fresh Shield receipt, within per-trade and daily loss limits. Transfers out are blocked, and you can always redeem in kind."],
  ["Which agents can use it?", "Any. Call the REST API, use the TypeScript SDK, or plug the MCP server into Claude, Cursor or any MCP-capable framework."],
  ["What does it cost?", "Shield is free for 1,000 checks per wallet per day, then $0.001 per check. Signals are priced per call by each provider. Vaults charge 15% of new profit only."],
  ["What is $HEIM for?", "Holding it makes the guardian cheaper: 5× free Shield checks, a 95/5 Signals split for providers, a 12.5% vault fee, and a Guardian badge."],
];

const trust = ["Built on Robinhood Chain", "Settled in USDG", "EIP-712 receipts", "Security reviewed", "MCP-ready"];

function SectionHead({ n, kicker, title, children, id }: { n: string; kicker: string; title: React.ReactNode; children?: React.ReactNode; id: string }) {
  return (
    <Reveal className="mb-10 grid gap-6 md:mb-14 md:grid-cols-[1fr_minmax(0,420px)] md:items-end">
      <div>
        <span className="font-mono text-[12px] font-semibold tracking-[0.12em] text-muted">{n} <span className="text-brand">//</span> {kicker}</span>
        <h2 id={id} className="display mt-3 text-[52px] sm:text-[68px] lg:text-[84px]">{title}</h2>
      </div>
      {children && <p className="text-[17px] leading-relaxed text-muted">{children}</p>}
    </Reveal>
  );
}

export default function Home() {
  return (
    <>
      {/* HERO */}
      <section className="relative -mt-16 overflow-hidden pt-16">
        <div className="mx-auto grid max-w-[1280px] gap-12 px-6 pb-14 pt-10 md:pt-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14">
          <div className="flex flex-col items-start">
            <span className="bg-ink px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-paper">Agent firewall · Robinhood Chain</span>
            <h1 className="mt-6 text-[17vw] leading-[0.86] sm:text-[96px] lg:text-[104px] xl:text-[118px]">Nothing gets signed <span className="text-brand">unchecked.</span></h1>
            <p className="mt-7 max-w-[540px] text-[16.5px] leading-relaxed text-ink/75 sm:text-[18px]">The guardian layer for AI agents that move money. Shield simulates every transaction and signature before your agent signs, and Heimdall vaults let agents trade without ever being able to take what they manage.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/app/shield" className="btn btn-primary">Protect an agent →</Link>
              <Link href="/check" className="btn btn-secondary">Check a wallet</Link>
            </div>
            <p className="mt-8 font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted">Simulated on the chain · Signed only if safe</p>
          </div>
          <Checkpoint />
        </div>
        <div className="mx-auto max-w-[1280px] px-6 pb-16">
          <div className="grid grid-cols-[minmax(0,1fr)] border border-ink bg-panel lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-3 border-b border-ink p-5 lg:border-b-0 lg:border-r">
              <span className="label text-ink">Check anything, free</span>
              <HeroCheck />
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-px bg-line md:grid-cols-4">
              <Suspense fallback={<><Stat label="…" value={null} /><Stat label="…" value={null} /><Stat label="…" value={null} /><Stat label="…" value={null} /></>}><Metrics /></Suspense>
            </div>
          </div>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted">
            {trust.map((t) => <li key={t} className="flex items-center gap-2"><span className="size-1.5 bg-brand" />{t}</li>)}
          </ul>
        </div>
      </section>

      {/* 01 HOW A CHECK WORKS */}
      <section aria-labelledby="how" className="border-y border-ink bg-panel">
        <div className="mx-auto grid max-w-[1280px] gap-12 px-6 py-24 lg:grid-cols-[1fr_1.15fr] lg:items-center">
          <div>
            <span className="font-mono text-[12px] font-semibold tracking-[0.12em] text-muted">01 <span className="text-brand">//</span> HOW A CHECK WORKS</span>
            <h2 id="how" className="display mt-3 text-[52px] sm:text-[68px] lg:text-[80px]">Ask first.<br />Sign <span className="text-brand">second.</span></h2>
            <p className="mt-6 max-w-[480px] text-[17px] leading-relaxed text-muted">Your agent sends the transaction to Shield before it signs. Shield runs it on live Robinhood Chain state and answers in under a second, with every reason in plain English.</p>
            <ul className="mt-8 flex flex-col divide-y divide-line border-y border-line">
              {[["Drainers & blocklist", "approvals and calls to known attackers"], ["Unlimited approvals", "to wallets or unknown contracts"], ["Honeypots & taxes", "tokens you could never sell"], ["Your own policy", "spend caps, allow lists, strict mode"]].map(([a, b]) => (
                <li key={a} className="flex items-baseline justify-between gap-4 py-3"><span className="font-semibold">{a}</span><span className="text-right text-[14px] text-muted">{b}</span></li>
              ))}
            </ul>
          </div>
          <CheckFlow />
        </div>
      </section>

      {/* 02 PRODUCTS */}
      <section aria-labelledby="products" className="mx-auto max-w-[1280px] px-6 py-24">
        <SectionHead n="02" kicker="THE GUARDIAN LAYER" id="products" title={<>Six guards.<br />One rule.</>}>Each product works on its own. Together, vaults only execute what Shield signs, agents buy their edge from Signals and get paid through Pay.</SectionHead>
        <div className="grid border-l border-t border-ink sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p, i) => (
            <Reveal key={p.name} delay={(i % 3) * 60}>
              <Link href={p.href} className="group flex h-full flex-col gap-4 border-b border-r border-ink bg-panel p-7 transition-colors hover:bg-ink hover:text-paper">
                <div className="flex items-center justify-between"><span className="font-mono text-[12px] font-semibold text-muted group-hover:text-paper/60">{String(i + 1).padStart(2, "0")}</span><span className="label group-hover:text-paper/60">{p.tag}</span></div>
                <h3 className="display text-[44px]">{p.name}</h3>
                <p className="text-[15px] leading-relaxed text-muted group-hover:text-paper/75">{p.d}</p>
                <span className="mt-auto flex items-center gap-2 pt-4 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-brand group-hover:text-peri">Open <Icon name="arrow" size={14} /></span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 03 WHO IT'S FOR */}
      <section aria-labelledby="built" className="border-y border-ink bg-ice">
        <div className="mx-auto max-w-[1280px] px-6 py-24">
          <SectionHead n="03" kicker="BUILT FOR" id="built" title={<>Builders, savers,<br />sellers.</>}>Whether you build agents, fund them or sell them data, the same rule applies: nothing gets signed unchecked.</SectionHead>
          <AudienceTabs items={audiences} />
        </div>
      </section>

      {/* 04 RULES */}
      <section aria-labelledby="enforced" className="mx-auto max-w-[1280px] px-6 py-24">
        <SectionHead n="04" kicker="ENFORCED ONCHAIN" id="enforced" title={<>Rules in the contract,<br /><span className="text-brand">not in a promise.</span></>}>How a Heimdall vault compares with a typical agent-managed vault.</SectionHead>
        <Reveal>
          <div className="overflow-x-auto border border-ink bg-panel">
            <table className="w-full min-w-[680px] border-collapse text-left text-[15px]">
              <thead><tr className="border-b border-ink"><th scope="col" className="px-6 py-4"><span className="sr-only">Feature</span></th><th className="label px-6 py-4">Typical agent vault</th><th className="label px-6 py-4 text-brand">Heimdall vault</th></tr></thead>
              <tbody>{compare.map(([k, a, b]) => (
                <tr key={k} className="border-t border-line">
                  <th scope="row" className="px-6 py-4 text-left font-semibold">{k}</th>
                  <td className="px-6 py-4 text-muted"><span className="inline-flex items-center gap-2"><span className="font-mono text-deny">✕</span>{a}</span></td>
                  <td className="px-6 py-4"><span className="inline-flex items-center gap-2 font-medium"><span className="font-mono text-allow">✓</span>{b}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Reveal>
      </section>

      {/* 05 PRICING */}
      <section aria-labelledby="pricing" className="border-y border-ink bg-panel">
        <div className="mx-auto max-w-[1280px] px-6 py-24">
          <SectionHead n="05" kicker="WHAT IT COSTS" id="pricing" title={<>Priced per check,<br />not per promise.</>}>No subscriptions to start. $HEIM holders pay less across the board.</SectionHead>
          <div className="grid border-l border-t border-ink sm:grid-cols-2 lg:grid-cols-4">
            {[["Shield", "Free", "1,000 checks per wallet, per day", "5× with $HEIM"], ["Shield API key", "$0.001", "per check above the free tier", "600 checks a minute"], ["Vaults", "15%", "of new profit only, nothing else", "12.5% if the manager holds $HEIM"], ["Pay", "1%", "of what the provider receives", "goes to $HEIM stakers"]].map(([k, v, d, n]) => (
              <div key={k} className="flex flex-col gap-3 border-b border-r border-ink p-6">
                <span className="label text-ink">{k}</span>
                <span className="display text-[72px] leading-none">{v}</span>
                <span className="text-[15px] text-ink/80">{d}</span>
                <span className="mt-auto pt-3 font-mono text-[11.5px] uppercase tracking-[0.06em] text-brand">{n}</span>
              </div>
            ))}
          </div>
          <Reveal className="mt-14"><FeeCalc /></Reveal>
        </div>
      </section>

      {/* 06 SECURITY + THREATS */}
      <section aria-labelledby="review" className="mx-auto max-w-[1280px] px-6 py-24">
        <SectionHead n="06" kicker="SECURITY" id="review" title={<>Reviewed before<br />a single deposit.</>}>Two reviews of every contract found 3 serious and 7 medium issues before launch. All are fixed and kept as regression tests next to property-based fuzzing, and a bug bounty pays up to 10,000 USDG.</SectionHead>
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <dl className="grid grid-cols-2 border-l border-t border-ink bg-panel">
            {[["10 / 10", "Serious & medium fixed"], ["112", "Contract tests"], ["25", "Fuzz & invariant properties"], ["10,000", "USDG cap per vault"]].map(([v, l]) => (
              <div key={l} className="border-b border-r border-ink p-6"><dt className="label">{l}</dt><dd className="display mt-3 text-[56px]">{v}</dd></div>
            ))}
          </dl>
          <div className="flex flex-col gap-4">
            <Link href="/threats" className="group flex flex-1 flex-col justify-between gap-6 border border-ink bg-ink p-7 text-paper">
              <span className="label text-paper/60">Live · Threat Board</span>
              <span className="display text-[44px]">Drainers caught on Robinhood Chain</span>
              <span className="flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-peri">Open the board <Icon name="arrow" size={14} /></span>
            </Link>
            <Link href="/security" className="btn btn-secondary">Read the security page</Link>
          </div>
        </div>
      </section>

      {/* 07 FAQ */}
      <section aria-labelledby="faq" className="border-t border-ink bg-panel">
        <div className="mx-auto grid max-w-[1280px] gap-10 px-6 py-24 lg:grid-cols-[1fr_1.6fr]">
          <div><span className="font-mono text-[12px] font-semibold tracking-[0.12em] text-muted">07 <span className="text-brand">//</span> FAQ</span><h2 id="faq" className="display mt-3 text-[56px] sm:text-[72px]">Questions,<br />answered.</h2></div>
          <div className="border-t border-ink">
            {faq.map(([q, a]) => (
              <details key={q} className="group border-b border-ink py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[18px] font-semibold">{q}<span className="font-mono text-[22px] font-normal text-brand transition group-open:rotate-45">+</span></summary>
                <p className="mt-3 max-w-[640px] text-[15.5px] leading-relaxed text-muted">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
