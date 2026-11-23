"use client";
import { track } from "@/lib/track";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { VerdictBadge } from "@/components/Verdict";
import { chain, short } from "@/lib/config";

type Verdict = "ALLOW" | "WARN" | "DENY";
interface Finding { code: string; severity: "info" | "warn" | "deny"; message: string }
interface Result {
  checkId: string; verdict: Verdict; riskScore: number; summary: string[]; findings: Finding[];
  simulation: { ok: boolean; available: boolean; revertReason?: string };
  receipt?: { signer: string; signature: string; expiresAt: number };
}
interface HistoryItem { verdict: Verdict; summary: string; to: string; risk: number; at: number }

const EXAMPLE = {
  from: "0x1111111111111111111111111111111111111111",
  to: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  data: "0x095ea7b30000000000000000000000003333333333333333333333333333333333333333ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  value: "0",
};
const POOL = "0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3"; // holds USDG on mainnet, used as a realistic sender
const USDG_ADDR = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const pad = (h: string) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const PRESETS: { label: string; hint: string; tx: typeof EXAMPLE }[] = [
  { label: "Drainer approval", hint: "Unlimited USDG to a wallet", tx: EXAMPLE },
  { label: "Router approval", hint: "100 USDG to Uniswap", tx: { from: POOL, to: USDG_ADDR, data: `0x095ea7b3${pad("0xcaf681a66d020601342297493863e78c959e5cb2")}${pad((100_000_000).toString(16))}`, value: "0" } },
  { label: "Send USDG", hint: "10 USDG to a new wallet", tx: { from: POOL, to: USDG_ADDR, data: `0xa9059cbb${pad("0x2222222222222222222222222222222222222222")}${pad((10_000_000).toString(16))}`, value: "0" } },
];
const HISTORY_KEY = "heimdall.shield.history";
const sevKind = (s: Finding["severity"]) => (s === "deny" ? "DENY" : s === "warn" ? "WARN" : "INFO") as "DENY" | "WARN" | "INFO";

function toWei(eth: string): string | undefined {
  if (!eth.trim()) return undefined;
  const [i, f = ""] = eth.trim().split(".");
  if (!/^\d*$/.test(i) || !/^\d*$/.test(f)) return undefined;
  return (BigInt(i || "0") * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18) || "0")).toString();
}

export function ShieldConsole() {
  const { address } = useAccount();
  const [tx, setTx] = useState(EXAMPLE);
  const [strict, setStrict] = useState(false);
  const [denyUnlimited, setDenyUnlimited] = useState(false);
  const [maxEth, setMaxEth] = useState("");
  const [allowTargets, setAllowTargets] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]")); } catch { /* storage unavailable */ }
  }, []);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true); setError(null);
    const targets = allowTargets.split(/[\s,]+/).filter(Boolean);
    const policy = {
      strict, denyUnlimitedApprovals: denyUnlimited,
      ...(toWei(maxEth) ? { maxNativeOut: toWei(maxEth) } : {}),
      ...(targets.length ? { allowTargets: targets } : {}),
    };
    try {
      const res = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId: chain.id, ...tx, to: tx.to || null, policy }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      setResult(body);
      track("shield_console_check");
      const item: HistoryItem = { verdict: body.verdict, summary: body.summary.slice(1).join(" · ") || body.summary[0], to: tx.to, risk: body.riskScore, at: Date.now() };
      const next = [item, ...history].slice(0, 20);
      setHistory(next);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    } catch (err) {
      setResult(null); setError((err as Error).message);
    } finally { setLoading(false); }
  }

  const headline = result?.findings.find((f) => f.severity === "deny") ?? result?.findings.find((f) => f.severity === "warn");
  const input = "min-h-11 rounded-lg border border-line-strong bg-panel px-3 py-2.5 font-mono text-[13px] outline-none focus:border-violet";

  return (
    <div className="mx-auto flex max-w-[1320px] flex-wrap items-start gap-6 pb-16 pt-8">
      <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><span className="eyebrow">Shield</span><h1 className="mt-1 text-[30px] font-bold tracking-[-0.025em]">Console</h1></div>
          <span className="inline-flex items-center gap-2 rounded-sm border border-line bg-panel px-3 py-1 text-[13px] text-muted"><span className="size-1.5 rounded-full bg-allow" />Simulated on {chain.name}, latest block</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-muted">Try an example:</span>
          {PRESETS.map((p) => (
            <button key={p.label} type="button" onClick={() => setTx(p.tx)} title={p.hint}
              className={`rounded-sm border px-3 py-1.5 text-[13px] font-medium transition ${tx.data === p.tx.data && tx.from === p.tx.from ? "border-brand/40 bg-brand-soft text-brand" : "border-line bg-panel hover:border-line-strong"}`}>{p.label}</button>
          ))}
        </div>

        <form onSubmit={run} className="card grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">From (agent wallet)
            <input className={input} value={tx.from} onChange={(e) => setTx({ ...tx, from: e.target.value })} spellCheck={false} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">To (target)
            <input className={input} value={tx.to} onChange={(e) => setTx({ ...tx, to: e.target.value })} spellCheck={false} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium sm:col-span-2">Calldata
            <textarea rows={3} className={`${input} resize-y`} value={tx.data} onChange={(e) => setTx({ ...tx, data: e.target.value })} spellCheck={false} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">Value (wei)
            <input className={input} value={tx.value} onChange={(e) => setTx({ ...tx, value: e.target.value })} spellCheck={false} />
          </label>
          <div className="flex flex-wrap items-end justify-end gap-2.5">
            {address && <button type="button" onClick={() => setTx({ ...tx, from: address })} className="btn btn-secondary">Use my wallet</button>}
            <button type="submit" disabled={loading} className="btn btn-primary disabled:opacity-60">{loading ? "Checking…" : "Run check"}</button>
          </div>
        </form>

        {error && <div role="alert" className="rounded-2xl border border-[#F5C2C4] bg-deny-soft px-6 py-4 text-sm text-deny">{error}</div>}

        {result && (
          <section aria-live="polite" className={`overflow-hidden rounded-2xl border bg-panel ${result.verdict === "DENY" ? "border-[#F5C2C4]" : "border-line"}`}>
            <div aria-hidden="true" className="bifrost h-1" />
            <div className="flex flex-wrap items-center gap-6 border-b border-line p-6">
              <VerdictBadge kind={result.verdict} size="lg" />
              <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1">
                <span className="text-lg font-semibold">{headline?.message ?? "No problems found."}</span>
                <span className="text-sm text-muted">{result.simulation.available ? (result.simulation.ok ? "Simulation succeeds on the latest block." : `Reverts: ${result.simulation.revertReason}`) : "Simulation unavailable."}</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-muted">Risk score</span>
                <span className={`font-mono text-[30px] ${result.riskScore >= 80 ? "text-deny" : result.riskScore > 0 ? "text-warn" : "text-allow"}`}>{result.riskScore}<span className="text-base text-muted">/100</span></span>
              </div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))]">
              <div className="flex flex-col gap-3 border-line p-6 sm:border-r">
                <h2 className="text-sm font-semibold text-muted">What this transaction does</h2>
                <ul className="flex flex-col gap-2.5 text-sm">{result.summary.map((s) => <li key={s} className="flex gap-2.5"><span aria-hidden="true" className="text-muted">→</span>{s}</li>)}</ul>
              </div>
              <div className="flex flex-col gap-3 p-6">
                <h2 className="text-sm font-semibold text-muted">Findings</h2>
                {result.findings.length === 0 && <p className="text-sm text-muted">None.</p>}
                <ul className="flex flex-col gap-2.5 text-sm">{result.findings.map((f) => <li key={f.code + f.message} className="flex items-start gap-2.5"><VerdictBadge kind={sevKind(f.severity)} /><span>{f.message}</span></li>)}</ul>
              </div>
            </div>
            {result.receipt && (
              <div className="flex flex-wrap gap-6 border-t border-line bg-ice px-6 py-4 text-[13px]">
                <span><span className="text-muted">Receipt signer </span><span className="font-mono">{short(result.receipt.signer)}</span></span>
                <span><span className="text-muted">Signature </span><span className="font-mono">{short(result.receipt.signature)}</span></span>
                <span><span className="text-muted">Check </span><span className="font-mono">{short(result.checkId)}</span></span>
                <button type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(result, null, 2))} className="ml-auto font-semibold hover:text-violet-ink">Copy JSON</button>
              </div>
            )}
          </section>
        )}

        <section aria-labelledby="recent" className="card p-6">
          <h2 id="recent" className="mb-4 text-lg font-semibold">Recent checks <span className="text-sm font-normal text-muted">(this browser)</span></h2>
          {history.length === 0 ? <p className="text-sm text-muted">No checks yet. Run one above.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="px-2 py-2.5 font-medium">Verdict</th><th className="px-2 py-2.5 font-medium">Summary</th><th className="px-2 py-2.5 font-medium">Target</th><th className="px-2 py-2.5 font-medium">Risk</th></tr></thead>
                <tbody>{history.map((h) => (
                  <tr key={h.at} className="border-t border-line"><td className="px-2 py-3"><VerdictBadge kind={h.verdict} /></td><td className="px-2 py-3">{h.summary}</td><td className="px-2 py-3 font-mono text-[13px]">{h.to ? short(h.to) : "deploy"}</td><td className="px-2 py-3 font-mono">{h.risk}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-6">
        <section aria-labelledby="policy" className="flex flex-col gap-4 card p-6">
          <h2 id="policy" className="text-lg font-semibold">Agent policy</h2>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">Strict mode (WARN becomes DENY)<input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} className="h-5 w-5 accent-violet" /></label>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">Block all unlimited approvals<input type="checkbox" checked={denyUnlimited} onChange={(e) => setDenyUnlimited(e.target.checked)} className="h-5 w-5 accent-violet" /></label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">Max ETH out per transaction
            <input className={input} placeholder="e.g. 0.05" value={maxEth} onChange={(e) => setMaxEth(e.target.value)} inputMode="decimal" />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">Allowed targets (optional)
            <textarea rows={3} className={`${input} resize-y`} placeholder="0x… one per line" value={allowTargets} onChange={(e) => setAllowTargets(e.target.value)} spellCheck={false} />
          </label>
          <p className="text-xs leading-relaxed text-muted">The policy is sent with each check. With the API or SDK you pass the same fields as <code className="font-mono">policy</code>.</p>
        </section>
        <section className="flex flex-col gap-3 card p-6 text-sm">
          <h2 className="text-lg font-semibold">Pricing</h2>
          <div className="flex justify-between"><span className="text-muted">Free checks</span><span className="font-mono">1,000 / day</span></div>
          <div className="flex justify-between"><span className="text-muted">Then</span><span className="font-mono">$0.001 / check</span></div>
          <a href="/app/keys" className="mt-1 inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong font-semibold">Manage API keys</a>
        </section>
      </aside>
    </div>
  );
}
