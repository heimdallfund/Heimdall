"use client";
import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { PUBLIC_API_URL } from "@/lib/config";
import { ConnectButton } from "@/components/ConnectButton";
import { Webhook } from "./Webhook";

interface Key { id: string; name: string; created: string; last4: string; checksToday: number }

export function ApiKeys() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<string | null>(null);
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const api = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(`${PUBLIC_API_URL}/v1${path}`, { ...init, headers: { "content-type": "application/json", ...(session ? { authorization: `Session ${session}` } : {}), ...(init?.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
    return body;
  }, [session]);

  const load = useCallback(async () => { if (session) setKeys(await api("/keys")); }, [api, session]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);
  useEffect(() => { setSession(null); setKeys([]); }, [address]);

  async function signIn() {
    setErr(null); setBusy(true);
    try {
      const { message } = await api("/auth/challenge", { method: "POST", body: JSON.stringify({ address }) });
      const signature = await signMessageAsync({ message });
      const { session: s } = await api("/auth/verify", { method: "POST", body: JSON.stringify({ address, signature }) });
      setSession(s);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { const r = await api("/keys", { method: "POST", body: JSON.stringify({ name }) }); setFresh(r.key); setName(""); await load(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true);
    try { await api(`/keys/${id}`, { method: "DELETE" }); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (!address) return <div className="rounded-2xl border border-line bg-panel p-6"><ConnectButton /></div>;
  if (!session) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-panel p-6">
        <p className="text-sm text-muted">Sign a message to prove you own this wallet. It does not send a transaction or cost gas.</p>
        <button type="button" onClick={signIn} disabled={busy} className="min-h-11 rounded-lg bg-brand px-5 font-semibold text-white disabled:opacity-50">{busy ? "Check your wallet…" : "Sign in"}</button>
        {err && <p role="alert" className="text-sm text-deny">{err}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {fresh && (
        <div role="status" className="flex flex-col gap-2 rounded-2xl border border-brand bg-brand-soft p-5">
          <span className="text-sm font-semibold">New key — copy it now, it will not be shown again</span>
          <div className="flex gap-2"><code className="flex-1 break-all rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-[13px]">{fresh}</code><button type="button" onClick={() => navigator.clipboard?.writeText(fresh)} className="min-h-11 rounded-lg bg-brand px-4 text-sm font-semibold text-white">Copy</button></div>
        </div>
      )}
      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-panel p-5">
        <label className="flex min-w-0 flex-[1_1_240px] flex-col gap-1.5 text-[13px] font-medium">Key name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. trader-01" maxLength={40} className="min-h-11 rounded-lg border border-line-strong px-3 outline-none focus:border-brand" /></label>
        <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-brand px-5 font-semibold text-white disabled:opacity-50">Create key</button>
      </form>
      <section className="overflow-hidden rounded-2xl border border-line bg-panel">
        {keys.length === 0 ? <p className="p-6 text-sm text-muted">No keys yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-ice text-left text-xs text-muted"><th className="px-5 py-3 font-medium">Name</th><th className="px-3 py-3 font-medium">Key</th><th className="px-3 py-3 font-medium">Created</th><th className="px-3 py-3 font-medium">Checks today</th><th className="px-5 py-3"><span className="sr-only">Revoke</span></th></tr></thead>
            <tbody>{keys.map((k) => (
              <tr key={k.id} className="border-t border-line">
                <td className="px-5 py-3.5 font-semibold">{k.name}</td>
                <td className="px-3 py-3.5 font-mono text-[13px]">hd_live_…{k.last4}</td>
                <td className="px-3 py-3.5 font-mono text-[13px]">{k.created.slice(0, 10)}</td>
                <td className="px-3 py-3.5 font-mono">{k.checksToday}</td>
                <td className="px-5 py-3.5 text-right"><button type="button" onClick={() => revoke(k.id)} disabled={busy} className="min-h-10 rounded-lg border border-line-strong px-3.5 text-sm font-semibold text-deny">Revoke</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
      {err && <p role="alert" className="text-sm text-deny">{err}</p>}
      <Webhook api={api} />
    </div>
  );
}
