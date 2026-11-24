import type { Metadata } from "next";
import { IconTile, type IconName } from "@/components/Icons";
import { ADDRESSES, explorerAddress } from "@/lib/config";

export const metadata: Metadata = {
  title: "Security",
  description: "How Heimdall protects agents, depositors and escrow, what has been reviewed and how to report a vulnerability.",
};

const CONTACT = "security@heimdall.fund";

const PROTECTIONS: [IconName, string, string][] = [
  ["receipt", "Shield receipts", "Every verdict is signed with EIP-712 (domain \"Heimdall Shield\", version 1). A receipt binds the exact account, target, calldata hash and value, expires after 120 seconds and works once."],
  ["list", "Vault guard", "Vaults only run calls with an ALLOW receipt, and only calls the multisig has allowlisted. Tokens can only be approved to reviewed routers. Each trade, and every 24 hours in total, can lose at most a fixed share of the vault, valued with oracle prices."],
  ["exit", "Always an exit", "redeemInKind returns your share of every asset, needs no price and works while a vault is paused. If one token is ever halted, redeemInKindExcept leaves it behind so the rest still comes out."],
  ["lock", "Escrow that can't get stuck", "Heimdall Pay settles every job exactly once. A dispute nobody decides splits 50/50 after 14 days, and if USDG freezes one party, the others are still paid."],
  ["gauge", "Price bounds", "Auto-Invest never buys while the oracle is stale or paused, and never fills worse than the bound you set (at most 5%). The fee your plan starts with never changes."],
  ["key", "Admin keys", "Every contract is owned by a multisig through two-step ownership. Fees have hard caps in code. Managers, keepers and arbiters can never withdraw anyone else's funds."],
];

const REVIEWS: [string, string, string, string][] = [
  ["Review 1", "Vaults, Signals, factory, Shield guard", "1 critical, 2 high, 6 medium, 5 low, 6 info", "/security/review-1.md"],
  ["Review 2", "Heimdall Pay, staking, fee splitter, stock price feed", "0 critical, 0 high, 1 medium, 5 low, 7 info", "/security/review-2.md"],
  ["Addendum", "Auto-Invest", "2 low, 3 info", "/security/review-2.md"],
  ["Review 3", "All contracts: invariant testing, ERC-4626 views, build size", "0 critical, 0 high, 0 medium, 2 low", "/security/review-3.md"],
  ["Review 4", "Risk Oracle, Guard for Safe, x402 facilitator, Agent Passport", "0 critical, 0 high, 1 medium, 2 low", "/security/review-4.md"],
  ["Review 5", "Guard for Safe token accounting, vault guardian", "0 critical, 0 high, 2 medium", "/security/review-5.md"],
  ["Review 6", "All contracts before mainnet deployment: swap recipients, staking stream", "0 critical, 1 high, 0 medium, 1 low", "/security/review-6.md"],
];

const CONTRACTS: [string, string | undefined][] = [
  ["HeimdallVaultFactory", ADDRESSES.factory], ["HeimdallSignals", ADDRESSES.signals], ["HeimdallPay", ADDRESSES.pay],
  ["HeimdallAutoInvest", ADDRESSES.autoInvest], ["HeimdallStaking", ADDRESSES.staking], ["HeimdallFeeSplitter", ADDRESSES.splitter],
];

export default function SecurityPage() {
  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-14 px-6 pb-24 pt-12">
      <header className="flex flex-col gap-4">
        <span className="eyebrow">Trust</span>
        <h1 className="text-[55px]">Security</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted">How Heimdall keeps agents honest and your funds out of reach, enforced by contracts rather than promises.</p>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["6", "internal reviews"], ["156", "contract tests"], ["29", "fuzz and invariant properties"], ["0", "open critical or high"]].map(([n, l]) => (
            <div key={l} className="card px-5 py-4"><p className="font-display text-[28px] font-bold tracking-[-0.02em]">{n}</p><p className="text-[13px] text-muted">{l}</p></div>
          ))}
        </div>
      </header>

      <section aria-labelledby="how" className="flex flex-col gap-5">
        <h2 id="how" className="display text-[41px]">How you are protected</h2>
        <div className="grid gap-4 md:grid-cols-2">{PROTECTIONS.map(([icon, t, d]) => (
          <section key={t} className="card flex flex-col gap-3 p-6"><IconTile name={icon} tone="allow" /><h3 className="text-[17px] font-semibold">{t}</h3><p className="leading-relaxed text-muted">{d}</p></section>
        ))}</div>
      </section>

      <section aria-labelledby="reviews" className="flex flex-col gap-5">
        <h2 id="reviews" className="display text-[41px]">Reviews and testing</h2>
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[640px] border-collapse text-left text-[15px]">
            <thead><tr className="bg-ice text-[13px]"><th className="px-5 py-3 font-semibold">Review</th><th className="px-5 py-3 font-semibold">Scope</th><th className="px-5 py-3 font-semibold">Found</th><th className="px-5 py-3 font-semibold">Report</th></tr></thead>
            <tbody>{REVIEWS.map(([n, sc, f, href]) => (
              <tr key={n} className="border-t border-line"><th scope="row" className="px-5 py-3 font-medium">{n}</th><td className="px-5 py-3 text-muted">{sc}</td><td className="px-5 py-3 text-muted">{f}</td><td className="px-5 py-3"><a className="font-medium text-brand hover:underline" href={href}>Read</a></td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="leading-relaxed text-muted">Every critical, high and medium finding is fixed, and each attack is kept as a test that must keep failing. The contracts also run property-based fuzzing (allowance safety, fee fairness, pro-rata exits, voucher accounting, escrow conservation, staking solvency, bounded Auto-Invest buys) and Slither static analysis. An independent audit comes next; its full report will be published here.</p>
      </section>

      <section id="audit" aria-labelledby="audit-h" className="flex flex-col gap-5 scroll-mt-24">
        <div><span className="eyebrow">Next</span><h2 id="audit-h" className="display mt-2 text-[41px]">Independent audit</h2></div>
        <div className="card flex flex-col gap-3 p-6">
          <p className="leading-relaxed text-muted">The contracts go to an independent audit firm. The audit pack is ready: scope with file hashes, threat model, invariants, known issues and every internal review. The full report will be published here, with every finding and how it was fixed.</p>
        </div>
      </section>

      <section id="report" aria-labelledby="report-h" className="flex flex-col gap-5 scroll-mt-24">
        <h2 id="report-h" className="display text-[41px]">Report a vulnerability</h2>
        <div className="card flex flex-col gap-3 p-6">
          <p className="leading-relaxed text-muted">Email <a className="font-medium text-brand hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a> with the steps or a proof of concept, ideally a test against a fork of Robinhood Chain. We reply within 48 hours.</p>
          <p className="leading-relaxed text-muted">Please test on a local fork, never on mainnet funds that are not yours, and keep the issue private until it is fixed. If you follow these rules, we will not take legal action over your research.</p>
        </div>
      </section>

      <section aria-labelledby="contracts" className="card overflow-hidden">
        <h2 id="contracts" className="border-b border-line px-6 py-4 text-[18px] font-semibold">Contracts · Robinhood Chain (4663)</h2>
        {CONTRACTS.map(([name, a]) => (
          <div key={name} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-6 py-3 last:border-0">
            <span className="text-[15px] font-medium">{name}</span>
            {a ? <a className="break-all font-mono text-[13.5px] text-brand hover:underline" href={explorerAddress(a)}>{a}</a> : <span className="text-[14px] text-muted">Published at launch</span>}
          </div>
        ))}
      </section>
    </div>
  );
}
