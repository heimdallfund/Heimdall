"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, erc20Abi, formatUnits, http, type Address } from "viem";
import { ADDRESSES, PUBLIC_API_URL, chain, explorerAddress, short } from "@/lib/config";
import { heimdallAutoInvestAbi, heimdallPayAbi, heimdallStakingAbi } from "@/lib/abi";

type Report = { id: string; reporter: string; address: string; evidence: string; note?: string; at: number; status: string };
type Decision = { id: string; address: string; reporter: string; status: string; at: number; by: string };
type Season = { id: number; name: string; start: number; end: number; minTvl: number; minDepositors: number; prize?: string };
type Overview = { stats: Record<"checks" | "allowed" | "warned" | "denied", number>; pendingReports: number; communityBlocklist: number; season: Season | null; seasonsSource: "admin" | "env" };
type Analytics = { days: string[]; daily: ({ day: string } & Record<string, number>)[]; totals: Record<string, number>; topPages: { path: string; views: number }[] };

const KEY = "heimdall-admin-key";
const fmt = (n: number) => n.toLocaleString("en-US");
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const toInput = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const fromInput = (v: string) => Date.parse(`${v}:00Z`);
const card = "rounded-xl border border-line bg-panel";

export function AdminPanel() {
  const [key, setKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { try { setKey(sessionStorage.getItem(KEY)); } catch { /* private mode */ } }, []);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(`${PUBLIC_API_URL}${path}`, { ...init, headers: { "content-type": "application/json", "x-admin-key": key ?? "", ...(init?.headers ?? {}) } });
    if (r.status === 403) { setKey(null); setError("That key was refused."); try { sessionStorage.removeItem(KEY); } catch {} throw new Error("That key was refused."); }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((body as { message?: string }).message ?? `Request failed (${r.status})`);
    return body as T;
  }, [key]);

  if (!key) {
    return (
      <form className={`${card} flex max-w-md flex-col gap-3 p-6`} onSubmit={(e) => { e.preventDefault(); if (!draft) return; try { sessionStorage.setItem(KEY, draft); } catch {} setKey(draft); setError(null); }}>
        <label htmlFor="k" className="font-semibold">Admin key</label>
        <input id="k" type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} className="rounded-lg border border-line bg-white px-3 py-2 font-mono text-[14px]" />
        {error && <p className="text-[14px] text-deny">{error}</p>}
        <button className="btn btn-primary self-start">Open</button>
        <p className="text-[13px] text-muted">The same key the monitor uses (its SHA-256 is SHIELD_ADMIN_KEY_SHA256 on the Shield API).</p>
      </form>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <OverviewPanel api={api} onLock={() => { try { sessionStorage.removeItem(KEY); } catch {} setKey(null); }} />
      <ReportsPanel api={api} />
      <BlocklistPanel api={api} />
      <SeasonsPanel api={api} />
      <GrowthPanel api={api} />
      <IncidentsPanel api={api} />
      <KeeperPanel />
      <AnalyticsPanel api={api} />
    </div>
  );
}

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = useCallback(() => { load().then((d) => { setData(d); setErr(null); }).catch((e: Error) => setErr(e.message)); }, [load]);
  useEffect(() => { refresh(); }, [refresh]);
  return { data, err, refresh };
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className={`${card} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-line px-5 py-4"><h2 className="text-[18px] font-semibold">{title}</h2>{action}</div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function OverviewPanel({ api, onLock }: { api: Api; onLock: () => void }) {
  const load = useCallback(() => api<Overview>("/v1/admin/overview"), [api]);
  const { data, err } = useLoad(load);
  return (
    <Section title="Overview" action={<button className="text-[14px] font-medium text-muted hover:text-ink" onClick={onLock}>Lock</button>}>
      {err && <p className="text-deny">{err}</p>}
      {data && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([["Shield checks", data.stats.checks], ["Denied", data.stats.denied], ["Reports waiting", data.pendingReports], ["Community blocklist", data.communityBlocklist]] as const).map(([l, v]) => (
            <div key={l} className="rounded-lg bg-ice p-4"><dt className="text-[13px] text-muted">{l}</dt><dd className="mt-1 font-mono text-[22px]">{fmt(v)}</dd></div>
          ))}
        </dl>
      )}
      {data && <p className="mt-3 text-[14px] text-muted">Arena: {data.season ? `${data.season.name}, ${utc(data.season.start)} to ${utc(data.season.end)}` : "no season set"} · seasons from {data.seasonsSource === "admin" ? "this panel" : "ARENA_SEASONS"}</p>}
    </Section>
  );
}

function ReportsPanel({ api }: { api: Api }) {
  const load = useCallback(() => Promise.all([api<Report[]>("/v1/reports"), api<Decision[]>("/v1/admin/decisions")]), [api]);
  const { data, err, refresh } = useLoad(load);
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (id: string, confirm: boolean) => {
    if (confirm && !window.confirm("Confirm this report? The address joins the blocklist and the reporter gets 200 points.")) return;
    setBusy(id);
    try { await api(`/v1/reports/${id}/decision`, { method: "POST", body: JSON.stringify({ confirm }) }); } finally { setBusy(null); refresh(); }
  };
  const [pending, decided] = data ?? [[], []];
  return (
    <Section title={`Drainer reports${pending.length ? ` · ${pending.length} waiting` : ""}`}>
      {err && <p className="text-deny">{err}</p>}
      {!pending.length && !err && <p className="text-muted">Nothing waiting.</p>}
      <ul className="flex flex-col gap-3">
        {pending.sort((a, b) => a.at - b.at).map((r) => (
          <li key={r.id} className="flex flex-col gap-2 rounded-lg border border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-[14.5px]">
              <a href={explorerAddress(r.address as Address)} target="_blank" rel="noopener" className="font-mono font-semibold hover:underline">{r.address}</a>
              <p className="text-muted">by <span className="font-mono">{short(r.reporter as Address)}</span> · {utc(r.at)} · <a className="text-brand hover:underline" href={r.evidence} target="_blank" rel="noopener noreferrer">evidence</a></p>
              {r.note && <p className="mt-1 break-words">{r.note}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              <button disabled={busy === r.id} onClick={() => decide(r.id, false)} className="btn btn-secondary">Reject</button>
              <button disabled={busy === r.id} onClick={() => decide(r.id, true)} className="btn btn-primary">Confirm</button>
            </div>
          </li>
        ))}
      </ul>
      {decided.length > 0 && (
        <details className="mt-4 text-[14px]"><summary className="cursor-pointer text-muted">Recent decisions ({decided.length})</summary>
          <ul className="mt-2 divide-y divide-line">{decided.slice(0, 30).map((d, i) => <li key={`${d.id}-${i}`} className="flex justify-between gap-3 py-2"><span className="font-mono">{short(d.address as Address)}</span><span className={d.status === "confirmed" ? "text-allow" : "text-muted"}>{d.status}</span><span className="text-muted">{utc(d.at)}</span></li>)}</ul>
        </details>
      )}
    </Section>
  );
}

function BlocklistPanel({ api }: { api: Api }) {
  const load = useCallback(() => api<{ address: string }[]>("/v1/admin/blocklist"), [api]);
  const { data, err, refresh } = useLoad(load);
  const remove = async (a: string) => {
    if (!window.confirm(`Remove ${a} from the community blocklist? Shield will stop denying it.`)) return;
    await api(`/v1/admin/blocklist/${a}`, { method: "DELETE" }).finally(refresh);
  };
  return (
    <Section title={`Community blocklist${data ? ` · ${data.length}` : ""}`}>
      {err && <p className="text-deny">{err}</p>}
      {data && !data.length && <p className="text-muted">No community-confirmed addresses yet.</p>}
      <ul className="divide-y divide-line">{data?.map((e) => (
        <li key={e.address} className="flex items-center justify-between gap-3 py-2 text-[14.5px]"><a href={explorerAddress(e.address as Address)} target="_blank" rel="noopener" className="truncate font-mono hover:underline">{e.address}</a><button onClick={() => remove(e.address)} className="shrink-0 text-[14px] font-medium text-deny hover:underline">Remove</button></li>
      ))}</ul>
    </Section>
  );
}

function SeasonsPanel({ api }: { api: Api }) {
  const load = useCallback(() => api<Season[]>("/v1/admin/arena/seasons"), [api]);
  const { data, err } = useLoad(load);
  const [rows, setRows] = useState<Season[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (data) setRows(data); }, [data]);
  const set = (i: number, patch: Partial<Season>) => setRows((r) => r.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const add = () => {
    const last = rows.at(-1); const start = last ? last.end : Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1);
    setRows([...rows, { id: (last?.id ?? 0) + 1, name: `Season ${(last?.id ?? 0) + 1}`, start, end: start + 30 * 86_400_000, minTvl: 500, minDepositors: 3 }]);
  };
  const save = async () => {
    setMsg(null);
    try { const saved = await api<Season[]>("/v1/admin/arena/seasons", { method: "PUT", body: JSON.stringify(rows) }); setRows(saved); setMsg("Saved. The public Arena board uses these now."); }
    catch (e) { setMsg((e as Error).message); }
  };
  const input = "w-full rounded-md border border-line bg-white px-2 py-1.5 text-[14px]";
  return (
    <Section title="Agent Arena seasons" action={<button onClick={add} className="text-[14px] font-medium text-brand hover:underline">Add season</button>}>
      {err && <p className="text-deny">{err}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-[14px]">
          <thead className="text-[12.5px] text-muted"><tr><th className="py-2 pr-2">ID</th><th className="pr-2">Name</th><th className="pr-2">Start (UTC)</th><th className="pr-2">End (UTC)</th><th className="pr-2">Min TVL (USDG)</th><th className="pr-2">Min depositors</th><th className="pr-2">Prize</th><th /></tr></thead>
          <tbody>{rows.map((s, i) => (
            <tr key={i} className="border-t border-line">
              <td className="py-2 pr-2 font-mono">{s.id}</td>
              <td className="pr-2"><input className={input} value={s.name} onChange={(e) => set(i, { name: e.target.value })} /></td>
              <td className="pr-2"><input type="datetime-local" className={input} value={toInput(s.start)} onChange={(e) => set(i, { start: fromInput(e.target.value) })} /></td>
              <td className="pr-2"><input type="datetime-local" className={input} value={toInput(s.end)} onChange={(e) => set(i, { end: fromInput(e.target.value) })} /></td>
              <td className="pr-2"><input type="number" min={0} className={input} value={s.minTvl} onChange={(e) => set(i, { minTvl: Number(e.target.value) })} /></td>
              <td className="pr-2"><input type="number" min={0} className={input} value={s.minDepositors} onChange={(e) => set(i, { minDepositors: Number(e.target.value) })} /></td>
              <td className="pr-2"><input className={input} value={s.prize ?? ""} placeholder="optional" onChange={(e) => set(i, { prize: e.target.value || undefined })} /></td>
              <td><button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-[13px] text-deny hover:underline">Delete</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center gap-4"><button onClick={save} className="btn btn-primary">Save seasons</button>{msg && <p className="text-[14px] text-muted">{msg}</p>}</div>
    </Section>
  );
}

type Incident = { id: string; title: string; status: string; started: number; resolved?: number; updates: { at: number; status: string; body: string }[] };
const ISTATUS = ["investigating", "identified", "monitoring", "resolved"] as const;

function IncidentsPanel({ api }: { api: Api }) {
  const load = useCallback(() => api<Incident[]>("/v1/admin/incidents"), [api]);
  const { data, err, refresh } = useLoad(load);
  const [form, setForm] = useState({ title: "", status: "investigating", body: "" });
  const [upd, setUpd] = useState<Record<string, { status: string; body: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const post = async (payload: Record<string, string>) => {
    setMsg(null);
    try { await api("/v1/admin/incidents", { method: "POST", body: JSON.stringify(payload) }); refresh(); return true; }
    catch (e) { setMsg((e as Error).message); return false; }
  };
  const input = "rounded-md border border-line bg-white px-2 py-1.5 text-[14px]";
  return (
    <Section title="Incidents (public status page)">
      {err && <p className="text-deny">{err}</p>}
      <form className="flex flex-col gap-2" onSubmit={async (e) => { e.preventDefault(); if (await post(form)) setForm({ title: "", status: "investigating", body: "" }); }}>
        <div className="flex flex-wrap gap-2"><input className={`${input} min-w-[240px] flex-1`} placeholder="Title, e.g. Wallet Check is slow" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{ISTATUS.map((x) => <option key={x}>{x}</option>)}</select></div>
        <textarea className={`${input} min-h-[70px]`} placeholder="What users see, what is affected, what you are doing" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        <button className="btn btn-primary self-start">Post incident</button>
      </form>
      {msg && <p className="mt-2 text-[14px] text-deny">{msg}</p>}
      <ul className="mt-5 flex flex-col gap-3">{data?.slice(0, 10).map((i) => {
        const u = upd[i.id] ?? { status: i.status === "resolved" ? "resolved" : "monitoring", body: "" };
        return (
          <li key={i.id} className="rounded-lg border border-line p-4 text-[14.5px]">
            <div className="flex justify-between gap-2"><b>{i.title}</b><span className={i.status === "resolved" ? "text-allow" : "text-warn"}>{i.status}</span></div>
            <p className="text-muted">{i.updates[0]?.body}</p>
            {i.status !== "resolved" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <select className={input} value={u.status} onChange={(e) => setUpd({ ...upd, [i.id]: { ...u, status: e.target.value } })}>{ISTATUS.map((x) => <option key={x}>{x}</option>)}</select>
                <input className={`${input} min-w-[200px] flex-1`} placeholder="Update" value={u.body} onChange={(e) => setUpd({ ...upd, [i.id]: { ...u, body: e.target.value } })} />
                <button type="button" className="btn btn-secondary" onClick={async () => { if (await post({ id: i.id, ...u })) setUpd({ ...upd, [i.id]: { status: u.status, body: "" } }); }}>Post update</button>
              </div>
            )}
          </li>
        );
      })}</ul>
    </Section>
  );
}

function KeeperPanel() {
  const client = useMemo(() => createPublicClient({ chain, transport: http() }), []);
  const load = useCallback(async () => {
    const out: [string, string, string][] = [];
    if (ADDRESSES.autoInvest) {
      const ai = ADDRESSES.autoInvest;
      const [count, accrued] = await Promise.all([
        client.readContract({ address: ai, abi: heimdallAutoInvestAbi, functionName: "planCount" }) as Promise<bigint>,
        client.readContract({ address: ai, abi: heimdallAutoInvestAbi, functionName: "accruedFees" }) as Promise<bigint>,
      ]);
      const ids = Array.from({ length: Math.min(Number(count), 500) }, (_, i) => BigInt(i));
      const due = (await Promise.all(ids.map((id) => client.readContract({ address: ai, abi: heimdallAutoInvestAbi, functionName: "isDue", args: [id] }).catch(() => false)))).filter(Boolean).length;
      out.push(["Auto-Invest buys due now", `${due} of ${count} plans`, "The monitor executes them every few minutes. Many due for long = keeper down or out of gas."]);
      out.push(["Auto-Invest fees waiting", `${formatUnits(accrued, 6)} USDG`, "Swept to the splitter before each daily distribution."]);
    }
    if (ADDRESSES.splitter) {
      const bal = await client.readContract({ address: ADDRESSES.usdg, abi: erc20Abi, functionName: "balanceOf", args: [ADDRESSES.splitter] });
      out.push(["Fees in the splitter", `${formatUnits(bal, 6)} USDG`, "Distributed once a day: 50% to stakers, the rest to the treasury."]);
    }
    if (ADDRESSES.staking) {
      const [staked, perDay] = await Promise.all([
        client.readContract({ address: ADDRESSES.staking, abi: heimdallStakingAbi, functionName: "totalStaked" }) as Promise<bigint>,
        client.readContract({ address: ADDRESSES.staking, abi: heimdallStakingAbi, functionName: "rewardPerDay" }) as Promise<bigint>,
      ]);
      out.push(["Staked $HEIM", Number(formatUnits(staked, 18)).toLocaleString("en-US", { maximumFractionDigits: 0 }), `Paying ${formatUnits(perDay, 6)} USDG a day right now.`]);
    }
    if (ADDRESSES.pay) {
      const owed = await client.readContract({ address: ADDRESSES.pay, abi: heimdallPayAbi, functionName: "totalOwed" }) as bigint;
      out.push(["Heimdall Pay owed", `${formatUnits(owed, 6)} USDG`, "Payouts parked for frozen addresses, waiting for withdrawOwed."]);
    }
    return out;
  }, [client]);
  const { data, err, refresh } = useLoad(load);
  return (
    <Section title="Keeper and fees (onchain)" action={<button onClick={refresh} className="text-[14px] font-medium text-brand hover:underline">Refresh</button>}>
      {err && <p className="text-deny">{err}</p>}
      {data && !data.length && <p className="text-muted">Contract addresses are not set in this build yet.</p>}
      <ul className="divide-y divide-line">{data?.map(([k, v, note]) => (
        <li key={k} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between"><span className="font-medium">{k}</span><span className="font-mono text-[15px]">{v}</span><span className="text-[13px] text-muted sm:max-w-[360px] sm:text-right">{note}</span></li>
      ))}</ul>
    </Section>
  );
}

const LABEL: Record<string, string> = {
  pageview: "Page views", wallet_check: "Wallet checks", revoke: "Revokes", report_submitted: "Reports", stake: "Stakes", unstake: "Unstakes", claim: "Claims",
  pay_job_created: "Pay jobs", pay_released: "Pay releases", plan_created: "Auto-Invest plans", vault_deposit: "Vault deposits", shield_console_check: "Console checks", docs_copy: "Code copied", early_access: "Early sign-ups", watch_on: "Wallet Watch on",
};

type Growth = {
  series: { day: string; signups: number; invites: number; qualified: number }[];
  totals: { early: number; inviters: number; invited: number; qualified: number };
  top: { inviter: string; invited: number; qualified: number; points: number; flags: string[] }[];
  flagged: { inviter: string; invited: number; qualified: number; points: number; flags: string[] }[];
};
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function GrowthPanel({ api }: { api: Api }) {
  const [days, setDays] = useState(14);
  const load = useCallback(() => api<Growth>(`/v1/admin/growth?days=${days}`), [api, days]);
  const { data, err } = useLoad(load);
  const max = Math.max(1, ...(data?.series.map((d) => d.signups) ?? [1]));
  return (
    <Section title="Growth: early access and invites" action={<select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-md border border-line bg-white px-2 py-1 text-[14px]">{[7, 14, 30, 60].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>}>
      {err && <p className="text-deny">{err}</p>}
      {data && (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([["Early access wallets", data.totals.early], ["Inviters", data.totals.inviters], ["Invited", data.totals.invited], ["Invites that used Heimdall", data.totals.qualified]] as const).map(([k, v]) => <div key={k} className="rounded-lg bg-ice p-3"><dt className="text-[12.5px] text-muted">{k}</dt><dd className="mt-0.5 font-mono text-[18px]">{fmt(v)}</dd></div>)}
          </dl>
          <div>
            <h3 className="mb-2 text-[14px] font-semibold">Sign-ups per day <span className="font-normal text-muted">(dark: from an invite)</span></h3>
            <div aria-label="Early access sign-ups per day" className="flex h-28 items-end gap-1">
              {data.series.map((d) => (
                <div key={d.day} title={`${d.day}: ${d.signups} sign-ups, ${d.invites} invited, ${d.qualified} qualified`} className="relative flex-1 rounded-t bg-brand/30" style={{ height: `${Math.max(2, (d.signups / max) * 100)}%` }}>
                  <div className="absolute inset-x-0 bottom-0 rounded-t bg-brand" style={{ height: `${d.signups ? (Math.min(d.invites, d.signups) / d.signups) * 100 : 0}%` }} />
                </div>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <h3 className="mb-2 text-[14px] font-semibold">Top inviters</h3>
            {!data.top.length ? <p className="text-[14px] text-muted">No invites yet.</p> : (
              <table className="w-full min-w-[560px] text-[14px]">
                <thead><tr className="text-left text-[12.5px] text-muted"><th className="py-1.5 font-medium">Wallet</th><th className="py-1.5 font-medium">Invited</th><th className="py-1.5 font-medium">Used Heimdall</th><th className="py-1.5 font-medium">Points</th><th className="py-1.5 font-medium">Flags</th></tr></thead>
                <tbody>{data.top.map((r) => (
                  <tr key={r.inviter} className="border-t border-line">
                    <td className="py-1.5 font-mono"><a className="text-brand hover:underline" href={`/check/${r.inviter}`}>{shortAddr(r.inviter)}</a></td>
                    <td className="py-1.5 font-mono">{r.invited}</td><td className="py-1.5 font-mono">{r.qualified}</td><td className="py-1.5 font-mono">{fmt(r.points)}</td>
                    <td className="py-1.5">{r.flags.length ? <span className="rounded-sm bg-warn-soft px-2 py-0.5 text-[12.5px] font-semibold text-warn">{r.flags.length} flag{r.flags.length > 1 ? "s" : ""}</span> : <span className="text-muted">–</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          {data.flagged.length > 0 && (
            <div>
              <h3 className="mb-2 text-[14px] font-semibold text-warn">Possible farming</h3>
              <ul className="flex flex-col gap-2 text-[14px]">{data.flagged.map((r) => (
                <li key={r.inviter} className="rounded-lg border border-warn/40 p-3"><span className="font-mono font-semibold">{shortAddr(r.inviter)}</span><ul className="mt-1 list-disc pl-5 text-muted">{r.flags.map((f) => <li key={f}>{f}</li>)}</ul></li>
              ))}</ul>
              <p className="mt-2 text-[13px] text-muted">Invite points are paid only when an invitee really uses Heimdall, so flagged invites usually cost nothing. Check before a season&apos;s rewards are settled.</p>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function AnalyticsPanel({ api }: { api: Api }) {
  const [days, setDays] = useState(14);
  const load = useCallback(() => api<Analytics>(`/v1/admin/analytics?days=${days}`), [api, days]);
  const { data, err } = useLoad(load);
  const max = Math.max(1, ...(data?.daily.map((d) => d.pageview ?? 0) ?? [1]));
  return (
    <Section title="Analytics" action={<select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-md border border-line bg-white px-2 py-1 text-[14px]">{[7, 14, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select>}>
      {err && <p className="text-deny">{err}</p>}
      {data && (
        <div className="flex flex-col gap-6">
          <div aria-label="Page views per day" className="flex h-32 items-end gap-1">
            {data.daily.map((d) => <div key={d.day} title={`${d.day}: ${fmt(d.pageview ?? 0)} views`} className="flex-1 rounded-t bg-brand/70" style={{ height: `${Math.max(2, ((d.pageview ?? 0) / max) * 100)}%` }} />)}
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(data.totals).map(([k, v]) => <div key={k} className="rounded-lg bg-ice p-3"><dt className="text-[12.5px] text-muted">{LABEL[k] ?? k}</dt><dd className="mt-0.5 font-mono text-[18px]">{fmt(v)}</dd></div>)}
          </dl>
          <div><h3 className="mb-2 text-[14px] font-semibold">Top pages</h3>
            <ul className="divide-y divide-line text-[14px]">{data.topPages.map((p) => <li key={p.path} className="flex justify-between py-1.5"><span className="font-mono">{p.path}</span><span className="font-mono">{fmt(p.views)}</span></li>)}</ul>
            {!data.topPages.length && <p className="text-[14px] text-muted">No visits recorded yet.</p>}
          </div>
          <p className="text-[13px] text-muted">Counts only: no cookies, no IP addresses, no wallet addresses. Addresses and ids in paths are replaced before anything is stored.</p>
        </div>
      )}
    </Section>
  );
}
