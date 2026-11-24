"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Api = (path: string, init?: RequestInit) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Delivery { id: string; type: string; at: number; status: number | null; ok: boolean; ms: number; error?: string }
interface Hook { url: string; events: string[]; wallets: string[]; secretHint: string; created: number; disabled?: string; deliveries: Delivery[] }

const EVENTS = [
  ["shield.deny", "Shield blocked a check", "A transaction or signature checked with one of your keys was denied."],
  ["shield.warn", "Shield warned on a check", "Same, for WARN verdicts."],
  ["wallet.risky_approval", "Risky approval on a watched wallet", "One of the wallets below gained a new Danger or Review approval."],
  ["token.rugged", "A token rugged", "Any Robinhood Chain token Heimdall checked while it traded had its liquidity pulled or stopped selling. With the verdict from before."],
] as const;
const utc = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function Webhook({ api }: { api: Api }) {
  const [hook, setHook] = useState<Hook | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(EVENTS.map((e) => e[0]));
  const [wallets, setWallets] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = (await api("/webhook")) as { webhook: Hook | null };
    setHook(r.webhook);
    if (r.webhook) { setUrl(r.webhook.url); setEvents(r.webhook.events); setWallets(r.webhook.wallets.join("\n")); }
  }, [api]);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(null); try { await fn(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); } };
  const save = (e: React.FormEvent) => { e.preventDefault(); void run(async () => {
    const r = await api("/webhook", { method: "PUT", body: JSON.stringify({ url, events, wallets: wallets.split(/[\s,]+/).filter(Boolean) }) });
    if (r.secret) setSecret(r.secret);
    setMsg({ ok: true, text: "Saved." }); await load();
  }); };
  const test = () => run(async () => { const d = (await api("/webhook/test", { method: "POST" })) as Delivery; setMsg({ ok: d.ok, text: d.ok ? `Test delivered: HTTP ${d.status} in ${d.ms} ms.` : `Test failed: ${d.error ?? `HTTP ${d.status}`}.` }); await load(); });
  const rotate = () => run(async () => { const r = await api("/webhook/rotate", { method: "POST" }); setSecret(r.secret); setMsg({ ok: true, text: "New secret created. Update your endpoint now: the old one no longer verifies." }); });
  const remove = () => run(async () => { await api("/webhook", { method: "DELETE" }); setHook(null); setUrl(""); setWallets(""); setSecret(null); setMsg({ ok: true, text: "Webhook deleted." }); });

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[20px] font-bold tracking-[-0.02em]">Webhook</h2>
        <Link href="/docs/webhooks" className="text-[14px] font-semibold text-brand hover:underline">Payloads and verification →</Link>
      </div>
      <p className="text-[14.5px] leading-relaxed text-muted">Get a signed POST when Shield blocks one of your agents, or when a wallet you run picks up a risky approval. One endpoint per account.</p>
      {hook?.disabled && <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-[14px] text-warn">{hook.disabled}</p>}
      {secret && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-brand bg-brand-soft p-4">
          <span className="text-sm font-semibold">Signing secret: copy it now, it is shown once</span>
          <div className="flex gap-2"><code className="flex-1 break-all rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-[13px]">{secret}</code><button type="button" onClick={() => navigator.clipboard?.writeText(secret)} className="min-h-11 rounded-lg bg-brand px-4 text-sm font-semibold text-white">Copy</button></div>
        </div>
      )}
      <form onSubmit={save} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">Endpoint URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} type="url" required placeholder="https://your-agent.example.com/heimdall" className="min-h-11 rounded-lg border border-line-strong px-3 font-mono text-[14px] outline-none focus:border-brand" />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">Events</legend>
          {EVENTS.map(([id, label, hint]) => (
            <label key={id} className="flex items-start gap-3 rounded-lg border border-line p-3 text-[14px]">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--color-brand)]" checked={events.includes(id)} onChange={(e) => setEvents(e.target.checked ? [...events, id] : events.filter((x) => x !== id))} />
              <span><span className="font-semibold">{label}</span> <code className="font-mono text-[12px] text-muted">{id}</code><span className="block text-muted">{hint}</span></span>
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">Wallets to watch (up to 20, one per line)
          <textarea value={wallets} onChange={(e) => setWallets(e.target.value)} rows={3} placeholder="0x… your agent's wallet" className="rounded-lg border border-line-strong px-3 py-2 font-mono text-[13px] outline-none focus:border-brand" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-brand px-5 font-semibold text-white disabled:opacity-50">{hook ? "Save changes" : "Create webhook"}</button>
          {hook && <>
            <button type="button" onClick={test} disabled={busy} className="min-h-11 rounded-lg border border-line-strong px-4 font-semibold">Send test event</button>
            <button type="button" onClick={rotate} disabled={busy} className="min-h-11 rounded-lg border border-line-strong px-4 font-semibold">New secret</button>
            <button type="button" onClick={remove} disabled={busy} className="min-h-11 rounded-lg border border-line-strong px-4 font-semibold text-deny">Delete</button>
          </>}
        </div>
      </form>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[14px] ${msg.ok ? "text-allow" : "text-deny"}`}>{msg.text}</p>}
      {hook && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[15px] font-semibold">Recent deliveries <span className="font-normal text-muted">· secret {hook.secretHint}</span></h3>
          {!hook.deliveries.length ? <p className="text-[14px] text-muted">None yet. Send a test event.</p> : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[520px] text-[13.5px]">
                <thead><tr className="bg-ice text-left text-[12px] text-muted"><th className="px-3 py-2 font-medium">Time</th><th className="px-3 py-2 font-medium">Event</th><th className="px-3 py-2 font-medium">Result</th><th className="px-3 py-2 font-medium">Time taken</th></tr></thead>
                <tbody>{hook.deliveries.map((d) => (
                  <tr key={d.id} className="border-t border-line">
                    <td className="px-3 py-2 font-mono">{utc(d.at)}</td>
                    <td className="px-3 py-2 font-mono">{d.type}</td>
                    <td className={`px-3 py-2 font-semibold ${d.ok ? "text-allow" : "text-deny"}`}>{d.ok ? `HTTP ${d.status}` : d.error ?? `HTTP ${d.status}`}</td>
                    <td className="px-3 py-2 font-mono">{d.ms} ms</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
