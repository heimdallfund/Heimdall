"use client";
import { useEffect, useRef, useState } from "react";

export type State = "ok" | "degraded" | "down" | "unknown";
export type Status = {
  overall: State; updated: number; block?: string | null; version?: string; mode?: "prelaunch" | "live"; shieldMs?: number;
  services: { id: string; name: string; state: State; detail: string; at?: number; ms?: number }[];
  uptime: Record<string, { day: string; pct: number | null }[]>;
  activity?: { total: number; allowed: number; warned: number; denied: number; today: number; days: { day: string; checks: number; warned: number; denied: number }[] };
  protection?: { blocklisted: number; riskListed: number };
  incidents: { id: string; title: string; status: string; started: number; resolved?: number; updates: { at: number; status: string; body: string }[] }[];
};

const POLL_MS = 15_000;
const LABEL: Record<State, string> = { ok: "Operational", degraded: "Degraded", down: "Down", unknown: "No data" };
const DOT: Record<State, string> = { ok: "bg-allow", degraded: "bg-warn", down: "bg-deny", unknown: "bg-line-strong" };
const UPTIME_NAMES: Record<string, string> = { shield: "Shield API", rpc: "Robinhood Chain RPC", monitor: "Vault monitor" };
const utc = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const n = (v: number) => v.toLocaleString("en-US");

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
}

/** Response times seen while this page has been open: newest on the right. */
function Spark({ values, max }: { values: number[]; max: number }) {
  if (values.length < 2) return <div className="h-8" aria-hidden />;
  const w = 120, h = 32, step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (Math.min(v, max) / max) * (h - 4)).toFixed(1)}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full" preserveAspectRatio="none" aria-hidden><polyline points={pts} fill="none" stroke="var(--color-brand)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}

function Tile({ label, value, sub, children }: { label: string; value: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="card flex min-w-0 flex-col gap-1 p-4">
      <span className="label">{label}</span>
      <span className="font-mono text-[18px] font-semibold tabular-nums leading-tight min-[420px]:text-[22px] sm:text-[24px]">{value}</span>
      {sub && <span className="truncate text-[12.5px] text-muted">{sub}</span>}
      {children}
    </div>
  );
}

function UptimeBar({ pct, day }: { pct: number | null; day: string }) {
  const c = pct === null ? "bg-line" : pct >= 99.5 ? "bg-allow" : pct >= 95 ? "bg-warn" : "bg-deny";
  return <span title={`${day}: ${pct === null ? "no data" : `${pct}%`}`} className={`h-8 flex-1 rounded-[3px] ${c}`} />;
}

export function LiveStatus({ initial }: { initial: Status | null }) {
  const [s, setS] = useState<Status | null>(initial);
  const [lastOk, setLastOk] = useState<number | null>(initial ? Date.now() : null);
  const [failed, setFailed] = useState(!initial);
  const [now, setNow] = useState(Date.now());
  const [blockFlash, setBlockFlash] = useState(false);
  const hist = useRef<{ shield: number[]; rpc: number[] }>({ shield: [], rpc: [] });
  const [, bump] = useState(0);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/status/full", { cache: "no-store" });
        if (!r.ok) throw new Error();
        const next = (await r.json()) as Status;
        if (stop) return;
        setS((prev) => { if (prev?.block && next.block && prev.block !== next.block) { setBlockFlash(true); setTimeout(() => setBlockFlash(false), 900); } return next; });
        const rpcMs = next.services.find((x) => x.id === "rpc")?.ms;
        if (next.shieldMs !== undefined) hist.current.shield = [...hist.current.shield, next.shieldMs].slice(-40);
        if (rpcMs !== undefined) hist.current.rpc = [...hist.current.rpc, rpcMs].slice(-40);
        bump((x) => x + 1);
        setLastOk(Date.now()); setFailed(false);
      } catch { if (!stop) setFailed(true); }
    };
    void tick();
    const i = setInterval(tick, POLL_MS);
    const c = setInterval(() => setNow(Date.now()), 1_000);
    const vis = () => { if (!document.hidden) void tick(); };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; clearInterval(i); clearInterval(c); document.removeEventListener("visibilitychange", vis); };
  }, []);

  if (!s) {
    return (
      <section className="card flex items-center gap-3 border-deny/40 p-6"><span className="size-3 shrink-0 rounded-full bg-deny" /><div><p className="text-[18px] font-semibold">Shield API is not answering</p><p className="text-muted">Checks, Wallet Check and Pay lookups may fail. Your funds in contracts are not affected. This page retries every 15 seconds.</p></div></section>
    );
  }

  const overall: State = failed ? "down" : s.overall;
  const head = failed ? "Shield API stopped answering" : overall === "ok" ? "All systems operational" : overall === "degraded" ? "Some systems are degraded" : "Part of Heimdall is down";
  const rpc = s.services.find((x) => x.id === "rpc");
  const a = s.activity;
  const dayMax = a ? Math.max(1, ...a.days.map((d) => d.checks)) : 1;
  const mix = a && a.total ? [{ k: "Allowed", v: a.allowed, c: "bg-allow" }, { k: "Warned", v: a.warned, c: "bg-warn" }, { k: "Blocked", v: a.denied, c: "bg-deny" }] : null;

  return (
    <>
      <section className={`card flex flex-wrap items-center gap-3 p-6 ${overall === "ok" ? "border-allow/40" : overall === "degraded" ? "border-warn/40" : "border-deny/40"}`}>
        <span className="relative flex size-3 shrink-0">
          {overall === "ok" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-allow opacity-60 motion-reduce:hidden" />}
          <span className={`relative inline-flex size-3 rounded-full ${DOT[overall]}`} />
        </span>
        <p className="text-[20px] font-semibold">{head}</p>
        <span className="ml-auto flex items-center gap-2 font-mono text-[12.5px] text-muted">
          <span className="tag bg-ink/5 text-ink">Live</span>
          {lastOk ? `updated ${ago(now - lastOk)}` : `as of ${utc(s.updated)}`}
        </span>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Robinhood Chain head" value={s.block ? `#${n(Number(s.block))}` : "—"} sub={rpc?.detail.split(" · ").slice(1).join(" · ")}>
          <span className={`h-[3px] w-full rounded-full transition-colors duration-700 ${blockFlash ? "bg-allow" : "bg-line"}`} aria-hidden />
        </Tile>
        <Tile label="Shield response" value={s.shieldMs !== undefined ? `${s.shieldMs} ms` : "—"} sub="from this site, every 15 s"><Spark values={hist.current.shield} max={Math.max(400, ...hist.current.shield)} /></Tile>
        <Tile label="RPC response" value={rpc?.ms !== undefined ? `${rpc.ms} ms` : "—"} sub="Shield to the chain"><Spark values={hist.current.rpc} max={Math.max(400, ...hist.current.rpc)} /></Tile>
        <Tile label="Checks today" value={a ? n(a.today) : "—"} sub="since 00:00 UTC" />
        <Tile label="Checks, all time" value={a ? n(a.total) : "—"} sub={a && a.total ? `${n(a.denied)} blocked before signing` : "counting starts with the first check"} />
        <Tile label="Known bad addresses" value={s.protection ? n(Math.max(s.protection.blocklisted, s.protection.riskListed)) : "—"} sub="blocked by every Shield check" />
      </section>

      <section className="card divide-y divide-line">
        {s.services.map((x) => (
          <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
            <span className="font-medium">{x.name}</span>
            <span className="flex min-w-0 items-center gap-3 text-[14px]"><span className="truncate text-muted">{x.detail}</span><span className="flex shrink-0 items-center gap-1.5 font-medium"><span className={`size-2.5 shrink-0 rounded-full ${DOT[x.state]}`} />{LABEL[x.state]}</span></span>
          </div>
        ))}
      </section>

      {a && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-2"><h2 className="display text-[32px]">Checks, last 30 days</h2><span className="font-mono text-[13px] text-muted">peak {n(dayMax === 1 && !a.days.some((d) => d.checks) ? 0 : dayMax)} a day</span></div>
          <div className="card p-5">
            <div className="flex h-36 items-end gap-[3px]" role="img" aria-label={`Checks per day for the last 30 days. Today: ${a.today}.`}>
              {a.days.map((d) => {
                const allowed = Math.max(0, d.checks - d.warned - d.denied);
                const pct = (v: number) => `${(v / dayMax) * 100}%`;
                return (
                  <div key={d.day} title={`${d.day}: ${n(d.checks)} checks, ${n(d.warned)} warned, ${n(d.denied)} blocked`} className="flex h-full flex-1 flex-col justify-end">
                    {d.checks === 0 ? <span className="h-[2px] rounded-[1px] bg-line" /> : <>
                      <span className="rounded-t-[2px] bg-deny" style={{ height: pct(d.denied) }} />
                      <span className="bg-warn" style={{ height: pct(d.warned) }} />
                      <span className="rounded-b-[1px] bg-allow" style={{ height: pct(allowed) }} />
                    </>}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between font-mono text-[11.5px] text-muted"><span>{a.days[0]?.day}</span><span>today</span></div>
            {mix && (
              <div className="mt-5 flex flex-col gap-2">
                <div className="flex h-2.5 overflow-hidden rounded-full bg-line">{mix.map((m) => <span key={m.k} className={m.c} style={{ width: `${(m.v / a.total) * 100}%` }} />)}</div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">{mix.map((m) => <span key={m.k} className="flex items-center gap-1.5"><span className={`size-2.5 rounded-[2px] ${m.c}`} />{m.k} <span className="font-mono text-muted">{n(m.v)} · {((m.v / a.total) * 100).toFixed(1)}%</span></span>)}</div>
              </div>
            )}
            {!a.total && <p className="mt-4 text-[13.5px] text-muted">No checks yet. Every transaction and signature Shield checks appears here, by verdict.</p>}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-5">
        <h2 className="display text-[32px]">Uptime, last 30 days</h2>
        {Object.entries(s.uptime).map(([svc, days]) => {
          const known = days.filter((d) => d.pct !== null);
          const avg = known.length ? known.reduce((x, d) => x + d.pct!, 0) / known.length : null;
          return (
            <div key={svc} className="flex flex-col gap-2">
              <div className="flex justify-between text-[14px]"><span className="font-medium">{UPTIME_NAMES[svc] ?? svc}</span><span className="font-mono text-muted">{avg === null ? "no data yet" : `${avg.toFixed(2)}% uptime`}</span></div>
              <div className="flex gap-[3px]" role="img" aria-label={`${UPTIME_NAMES[svc] ?? svc}: daily uptime for the last 30 days`}>{days.map((d) => <UptimeBar key={d.day} pct={d.pct} day={d.day} />)}</div>
            </div>
          );
        })}
        <p className="text-[13px] text-muted">Measured by the Heimdall monitor every two minutes. Grey means no measurement that day.</p>
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

      <p className="text-[13px] text-muted">
        Machine-readable: <code className="font-mono">GET https://api.heimdall.fund/v1/status</code>{s.version ? ` · Shield ${s.version}` : ""}{s.mode === "prelaunch" ? " · pre-launch: checks run, signed receipts start at launch" : ""}
      </p>
    </>
  );
}
