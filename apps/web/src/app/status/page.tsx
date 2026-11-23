import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { SHIELD_API_URL } from "@/lib/config";

export const metadata: Metadata = { title: "Status", description: "Live status of Heimdall Shield, the Robinhood Chain RPC, the vault monitor and the keeper, with 30 days of uptime and every incident." };

type State = "ok" | "degraded" | "down" | "unknown";
type Status = {
  overall: State; updated: number;
  services: { id: string; name: string; state: State; detail: string }[];
  uptime: Record<string, { day: string; pct: number | null }[]>;
  incidents: { id: string; title: string; status: string; started: number; resolved?: number; updates: { at: number; status: string; body: string }[] }[];
};

const LABEL: Record<State, string> = { ok: "Operational", degraded: "Degraded", down: "Down", unknown: "No data" };
const DOT: Record<State, string> = { ok: "bg-allow", degraded: "bg-warn", down: "bg-deny", unknown: "bg-line-strong" };
const utc = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const UPTIME_NAMES: Record<string, string> = { shield: "Shield API", rpc: "Robinhood Chain RPC", monitor: "Vault monitor" };

function Bar({ pct }: { pct: number | null }) {
  const c = pct === null ? "bg-line" : pct >= 99.5 ? "bg-allow" : pct >= 95 ? "bg-warn" : "bg-deny";
  return <span className={`h-8 flex-1 rounded-[3px] ${c}`} />;
}

async function Live() {
  await connection();
  const s = await fetch(`${SHIELD_API_URL}/v1/status`, { signal: AbortSignal.timeout(6_000), cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Status>) : null)).catch(() => null);
  if (!s) {
    return (
      <section className="card flex items-center gap-3 p-6"><span className="size-3 shrink-0 rounded-full bg-deny" /><div><p className="text-[18px] font-semibold">Shield API is not answering</p><p className="text-muted">Checks, Wallet Check and Pay lookups may fail. Your funds in contracts are not affected.</p></div></section>
    );
  }
  const head = s.overall === "ok" ? "All systems operational" : s.overall === "degraded" ? "Some systems are degraded" : "Part of Heimdall is down";
  return (
    <>
      <section className={`card flex items-center gap-3 p-6 ${s.overall === "ok" ? "border-allow/40" : s.overall === "degraded" ? "border-warn/40" : "border-deny/40"}`}>
        <span className={`size-3 shrink-0 rounded-full ${DOT[s.overall]}`} /><p className="text-[20px] font-semibold">{head}</p><span className="ml-auto text-[13px] text-muted">Updated {utc(s.updated)}</span>
      </section>
      <section className="card divide-y divide-line">
        {s.services.map((x) => (
          <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
            <span className="font-medium">{x.name}</span>
            <span className="flex items-center gap-3 text-[14px]"><span className="text-muted">{x.detail}</span><span className="flex items-center gap-1.5 font-medium"><span className={`size-2.5 shrink-0 rounded-full ${DOT[x.state]}`} />{LABEL[x.state]}</span></span>
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-5">
        <h2 className="display text-[32px]">Last 30 days</h2>
        {Object.entries(s.uptime).map(([svc, days]) => {
          const known = days.filter((d) => d.pct !== null);
          const avg = known.length ? known.reduce((a, d) => a + d.pct!, 0) / known.length : null;
          return (
            <div key={svc} className="flex flex-col gap-2">
              <div className="flex justify-between text-[14px]"><span className="font-medium">{UPTIME_NAMES[svc] ?? svc}</span><span className="font-mono text-muted">{avg === null ? "no data yet" : `${avg.toFixed(2)}% uptime`}</span></div>
              <div className="flex gap-[3px]" role="img" aria-label={`${UPTIME_NAMES[svc] ?? svc}: daily uptime for the last 30 days`}>{days.map((d) => <Bar key={d.day} pct={d.pct} />)}</div>
            </div>
          );
        })}
        <p className="text-[13px] text-muted">Measured by the Heimdall monitor every few minutes. Grey means no measurement that day.</p>
      </section>
      <section className="flex flex-col gap-4">
        <h2 className="display text-[32px]">Incidents</h2>
        {!s.incidents.length && <p className="text-muted">No incidents reported.</p>}
        {s.incidents.map((i) => (
          <article key={i.id} className="card flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[17px] font-semibold">{i.title}</h3><span className={`rounded-sm px-2.5 py-0.5 text-[12.5px] font-semibold ${i.status === "resolved" ? "bg-allow-soft text-allow" : "bg-warn-soft text-warn"}`}>{i.status}</span></div>
            <ol className="flex flex-col gap-2 border-l-2 border-line pl-4 text-[14.5px]">
              {i.updates.map((u) => <li key={u.at}><span className="font-semibold capitalize">{u.status}</span> · <span className="text-muted">{utc(u.at)}</span><p className="mt-0.5 leading-relaxed">{u.body}</p></li>)}
            </ol>
          </article>
        ))}
      </section>
    </>
  );
}

export default function StatusPage() {
  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-8 px-6 pb-24 pt-12">
      <header className="flex flex-col gap-2"><span className="eyebrow">Trust</span><h1 className="text-[50px]">Status</h1>
        <p className="text-muted">Contracts on Robinhood Chain keep working whatever this page says: deposits, escrow and staking do not depend on Heimdall&apos;s servers, and in-kind exits always work.</p></header>
      <Suspense fallback={<div className="card h-24 animate-pulse" />}><Live /></Suspense>
    </div>
  );
}
