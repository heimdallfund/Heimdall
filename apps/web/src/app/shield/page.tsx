import Link from "next/link";
import type { Metadata } from "next";
import { CtaBand, Faq, Steps } from "@/components/ProductSections";
import { VerdictBadge } from "@/components/Verdict";
import { ShieldVisual } from "@/components/Visuals";
import { Code } from "@/components/docs/Docs";
import { ClientTabs } from "@/components/docs/ClientTabs";
import { MCP_CLIENTS } from "@/lib/mcpClients";
import { FRAMEWORKS } from "@/lib/frameworks";

export const metadata: Metadata = { title: "Shield — transaction firewall for agents" };

const checks = [
  ["SIM_REVERTED", "DENY", "The transaction would revert on the latest block. The reason is decoded."],
  ["UNLIMITED_APPROVAL_TO_EOA", "DENY", "Unlimited ERC-20 or Permit2 approval to a plain wallet."],
  ["ZERO_TARGET", "DENY", "Sending to the zero address burns the funds."],
  ["PERMIT_TO_EOA", "DENY", "An offchain Permit or Permit2 signature that lets a plain wallet take your tokens."],
  ["BLIND_HASH_SIGNATURE", "DENY", "Signing a raw 32-byte hash, which can authorise anything."],
  ["HONEYPOT", "DENY", "A token you receive that cannot be moved again."],
  ["BLOCKLISTED_*", "DENY", "Target, spender or recipient is a known drainer or exploit address."],
  ["NATIVE_LIMIT / TOKEN_LIMIT", "DENY", "Above the agent's per-transaction cap for ETH or a token."],
  ["TARGET_NOT_ALLOWED", "DENY", "Target outside the agent's allow list, or on its deny list."],
  ["UNLIMITED_APPROVAL", "WARN", "Unlimited approval to a contract that is not a trusted spender, including inside multicall and Universal Router batches."],
  ["TRANSFER_TAX", "WARN", "A received token charges 5% or more on every transfer (50%+ is denied)."],
  ["PERMIT_LONG_EXPIRY", "WARN", "A permit that stays valid for more than 30 days."],
  ["DRAINS_BALANCE", "WARN", "Moves 90% or more of the wallet's balance of an asset."],
  ["ONE_WAY_OUTFLOW", "WARN", "Assets leave to an untrusted address and nothing comes back."],
  ["EOA_WITH_DATA", "WARN", "Calldata sent to an address with no contract code."],
  ["SIM_UNAVAILABLE", "WARN", "The simulator could not run; nothing is assumed safe."],
] as const;

export default function ShieldPage() {
  return (
    <div className="mx-auto max-w-[1240px] px-6 py-16">
      <div className="flex flex-wrap items-center gap-12">
      <div className="min-w-0 flex-[1_1_480px]">
      <span className="eyebrow">For agent builders · Shield</span>
      <h1 className="mt-3 max-w-3xl text-[55px] md:text-[68px]">A firewall between your agent and its signature.</h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
        Shield runs the exact transaction against live Robinhood Chain state with <code className="font-mono text-[15px]">eth_simulateV1</code>, reads every
        asset that would move, and judges it against your agent&apos;s policy. The answer comes back in plain words, with an EIP-712 receipt that Heimdall vaults verify onchain.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/app/shield" className="btn btn-primary">Open the console</Link>
        <Link href="/docs/shield" className="btn btn-secondary">API reference</Link>
      </div>
      </div>
      <div className="flex min-w-0 flex-[1_1_420px] justify-center"><ShieldVisual /></div>
      </div>

      <h2 className="display mt-24 text-[41px]">Every check, and what it does</h2>
      <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-panel">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead><tr className="bg-ice text-left text-xs text-muted"><th className="px-5 py-3 font-medium">Code</th><th className="px-3 py-3 font-medium">Verdict</th><th className="px-5 py-3 font-medium">When</th></tr></thead>
          <tbody>
            {checks.map(([code, v, d]) => (
              <tr key={code} className="border-t border-line"><td className="px-5 py-3.5 font-mono text-[13px]">{code}</td><td className="px-3 py-3.5"><VerdictBadge kind={v} /></td><td className="px-5 py-3.5 text-muted">{d}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-16 grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-5">
        {[
          ["Pricing", "1,000 free checks per day per wallet, then $0.001 per check in USDG. $HEIM holders get a larger free quota."],
          ["Strict mode", "Turn every WARN into DENY for agents that should never improvise."],
          ["Receipts", "Each verdict is signed (EIP-712) and expires after 120 seconds. Vaults refuse calls without a fresh ALLOW receipt."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl border border-line bg-panel p-6"><h3 className="text-lg font-semibold">{t}</h3><p className="mt-2 text-[15px] leading-relaxed text-muted">{d}</p></div>
        ))}
      </div>

      <Steps title="From intent to receipt in one call" steps={[
        ["code", "Send the transaction", "POST /v1/check with from, to, data and value, or call guardedSend from the SDK."],
        ["eye", "Shield simulates it", "eth_simulateV1 on the latest block: every asset change, approval and revert, judged against your policy."],
        ["receipt", "Act on the verdict", "ALLOW comes with an EIP-712 receipt valid for 120 seconds. WARN and DENY come with reasons."],
      ]} />
      <section className="grid min-w-0 gap-8 rounded-2xl border border-line bg-panel p-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:p-10">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="eyebrow">Connect your agent</p>
          <h2 className="display text-[41px]">One line of config. Every send and every signature checked.</h2>
          <p className="text-[15px] leading-relaxed text-muted">The Heimdall MCP server gives Claude, Cursor, ElizaOS, LangChain or any MCP agent sixteen tools: transaction and signature checks, address vetting, Wallet Check, the Threat Board, the Risk Oracle, Agent Passports, Heimdall Pay jobs, the Agent Arena and vault limits. It tells the model never to sign on DENY.</p>
          <Link href="/docs/mcp" className="mt-1 text-[15px] font-semibold text-brand hover:underline">All clients and tools →</Link>
        </div>
        <ClientTabs tabs={MCP_CLIENTS.filter((c) => ["claude-desktop", "claude-code", "cursor", "eliza"].includes(c.id)).map((c) => ({ id: c.id, label: c.label, pane: <Code lang={c.lang}>{c.code}</Code> }))} />
      </section>
      <section className="grid min-w-0 gap-8 rounded-2xl border border-line bg-panel p-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:p-10">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="eyebrow">Or use your framework</p>
          <h2 className="display text-[41px]">Native tools for the AI SDK, LangChain and ElizaOS.</h2>
          <p className="text-[15px] leading-relaxed text-muted"><code className="font-mono text-[13px] text-ink">@heimdallfund/agent-kit</code> adds the same checks as tools your agent already knows how to call. Give it a wallet and <code className="font-mono text-[13px] text-ink">heimdall_safe_send</code> only sends what Shield allows.</p>
          <Link href="/docs/frameworks" className="mt-1 text-[15px] font-semibold text-brand hover:underline">Setup and options →</Link>
        </div>
        <ClientTabs tabs={FRAMEWORKS.map((f) => ({ id: f.id, label: f.label, pane: <Code lang={f.lang}>{f.code}</Code> }))} />
      </section>
      <Faq items={[
        ["Does Shield hold my keys?", "No. Shield only sees the transaction you send it and returns a verdict. Your agent signs with its own wallet."],
        ["What about signatures, not transactions?", "POST /v1/check-signature judges Permit, Permit2, Seaport orders and personal_sign requests before your agent signs them."],
        ["How fast is it?", "A check is one simulation on the latest block, typically a few hundred milliseconds."],
        ["Is it free?", "1,000 checks per wallet per day are free. API keys lift the limits at $0.001 per check; $HEIM holders get 5× the free quota."],
      ]} />
      <CtaBand title="Protect your agent today" text="Try a transaction in the console, or drop guardedSend into your agent." primary={["/app/shield", "Open the console"]} secondary={["/docs/shield", "API reference"]} />
    </div>
  );
}
