"use client";
import { useEffect, useRef, useState } from "react";
import { PUBLIC_API_URL } from "@/lib/config";
import { TokenText } from "@/components/TokenIcon";

/**
 * Hero visual: agent transactions travel to the Shield line. Safe ones are stamped ALLOW and pass; risky ones are
 * stamped DENY and stop there. Blocked examples come from the live Threat Board when it has entries.
 */
type Job = { id: number; lane: number; agent: string; what: string; verdict: "ALLOW" | "DENY"; reason?: string };

const SAFE = [
  ["AGENT-07", "Swap 2,500 USDG → NVDA"], ["VAULT-02", "Rebalance TSLA · 4%"], ["AGENT-19", "Pay job · 25 USDG"],
  ["AGENT-04", "Auto-Invest · GOOGL"], ["VAULT-05", "Swap 800 USDG → AMZN"], ["AGENT-12", "Revoke old approval"],
] as const;
const RISKY = [
  ["AGENT-11", "Approve ∞ USDG → 0x3f…a91", "Spender is a plain wallet"],
  ["AGENT-23", "Sign Permit2 · all tokens", "Drainer on the blocklist"],
  ["AGENT-09", "Send 4.2 ETH", "Over the agent's spend cap"],
  ["AGENT-16", "Buy MOON · 1,000 USDG", "Honeypot: cannot be sold"],
] as const;
const LANES = [17, 32, 47, 62, 77];
const TRAVEL = 8; // seconds for a full pass

const pretty = (code: string) => code.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

export function Checkpoint() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [reduced, setReduced] = useState(false);
  const risky = useRef<(readonly [string, string, string])[]>([...RISKY]);
  const n = useRef(0);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    fetch(`${PUBLIC_API_URL}/v1/threats`).then((r) => r.json()).then((j: { recent?: { codes: string[]; target: string | null; kind: string }[] }) => {
      const live = (j.recent ?? []).filter((r) => r.codes[0]).slice(0, 4).map((r, i) => [`AGENT-${30 + i}`, r.kind === "sig" ? "Signature request" : `Call ${r.target ? `${r.target.slice(0, 6)}…${r.target.slice(-3)}` : "contract"}`, pretty(r.codes[0]!)] as const);
      if (live.length >= 2) risky.current = live;
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (reduced) return;
    let lastLane = -1;
    const spawn = () => {
      const id = ++n.current;
      let lane = Math.floor(Math.random() * LANES.length);
      if (lane === lastLane) lane = (lane + 2) % LANES.length;
      lastLane = lane;
      const deny = id % 3 === 0;
      const job: Job = deny
        ? (() => { const r = risky.current[(id / 3) % risky.current.length | 0]!; return { id, lane, agent: r[0], what: r[1], verdict: "DENY" as const, reason: r[2] }; })()
        : (() => { const s = SAFE[id % SAFE.length]!; return { id, lane, agent: s[0], what: s[1], verdict: "ALLOW" as const }; })();
      setJobs((js) => [...js.filter((j) => id - j.id < 7), job]);
    };
    spawn();
    const t = setInterval(() => { if (!document.hidden) spawn(); }, 1500);
    return () => clearInterval(t);
  }, [reduced]);

  const shown: Job[] = reduced
    ? [{ id: 1, lane: 0, agent: "AGENT-07", what: SAFE[0][1], verdict: "ALLOW" }, { id: 2, lane: 2, agent: "AGENT-11", what: RISKY[0][1], verdict: "DENY", reason: RISKY[0][2] }, { id: 3, lane: 4, agent: "VAULT-02", what: SAFE[1][1], verdict: "ALLOW" }]
    : jobs;

  return (
    <div aria-hidden="true" className="checkpoint grid-paper relative h-[340px] overflow-hidden border border-ink bg-panel shadow-[6px_6px_0_var(--color-ink)] sm:h-[420px] lg:h-[480px]" style={{ containerType: "inline-size" }}>
      <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_60%_50%,rgba(246,244,238,0)_0%,rgba(246,244,238,0.9)_100%)]" />
      {/* the Shield line */}
      <div className="checkpoint-track absolute inset-y-0 left-[58%] w-px bg-brand">
        <div className="checkpoint-scan absolute -left-[3px] top-0 h-24 w-[7px] bg-gradient-to-b from-transparent via-brand to-transparent opacity-70" />
      </div>
      <div className="absolute left-[58%] top-3 -translate-x-1/2 border border-brand bg-brand px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-white">Shield</div>
      <div className="absolute bottom-3 left-3 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Agent transactions</div>
      <div className="absolute bottom-3 right-3 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Signed onchain</div>

      {shown.map((j) => (
        <div key={j.id} className="absolute left-0" style={{ top: `${LANES[j.lane]}%` }}>
          <div className={reduced ? "" : j.verdict === "ALLOW" ? "cp-pass" : "cp-stop"} style={reduced ? { transform: `translateX(${j.verdict === "DENY" ? "calc(58cqw - 100% - 6px)" : j.id === 1 ? "66cqw" : "6cqw"})` } : { animationDuration: `${TRAVEL}s` }}>
            <div className="relative flex items-start gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" className="mt-0.5 shrink-0"><path d="M3 2l18 8-8 3-3 8z" fill="var(--color-ink)" /></svg>
              <div className={`border bg-panel ${j.verdict === "DENY" && !reduced ? "cp-tint" : j.verdict === "DENY" ? "border-deny" : "border-ink"}`} style={reduced ? undefined : { animationDuration: `${TRAVEL}s` }}>
                <div className={`px-2 py-0.5 font-mono text-[10.5px] font-bold tracking-[0.08em] text-white ${j.verdict === "DENY" ? (reduced ? "bg-deny" : "bg-ink cp-tint-head") : "bg-ink"}`} style={reduced ? undefined : { animationDuration: `${TRAVEL}s` }}>{j.agent}</div>
                <div className="whitespace-nowrap px-2 py-1 font-mono text-[11px] text-ink/80"><TokenText text={j.what} size={13} /></div>
              </div>
              {/* the verdict stamp lands on the card at the Shield line and travels with it */}
              {(!reduced || j.id !== 3) && (
                <div className={`absolute -right-3 -top-3 ${reduced ? "" : "cp-stamp"}`} style={reduced ? { transform: "rotate(-4deg)" } : { animationDuration: `${TRAVEL}s` }}>
                  <span className={`tag whitespace-nowrap border-2 shadow-[2px_2px_0_var(--color-ink)] ${j.verdict === "ALLOW" ? "border-allow bg-allow-soft text-allow" : "border-deny bg-deny-soft text-deny"}`}>{j.verdict === "ALLOW" ? "✓ Allow" : "✕ Deny"}</span>
                </div>
              )}
              {j.reason && <div className={`absolute left-5 top-full mt-1.5 whitespace-nowrap bg-deny px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-white ${reduced ? "" : "cp-fade"}`} style={reduced ? undefined : { animationDuration: `${TRAVEL}s` }}>{j.reason}</div>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
