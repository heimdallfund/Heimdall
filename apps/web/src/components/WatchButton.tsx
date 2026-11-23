"use client";
import { useEffect, useState } from "react";
import { PUBLIC_API_URL } from "@/lib/config";
import { track } from "@/lib/track";

const KEY = "heimdall-watching";
const b64ToBytes = (b64: string) => { const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
const list = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; } };
const save = (l: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch {} };

/** Wallet Watch: a browser notification when this wallet gains a new risky approval. No account, no email. */
export function WatchButton({ address }: { address: string }) {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    setSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
    setOn(list().includes(address.toLowerCase()));
  }, [address]);
  if (!supported) return null;

  async function start() {
    setBusy(true); setMsg(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") { setMsg("Notifications are blocked for this site in your browser settings."); return; }
      const v = await fetch(`${PUBLIC_API_URL}/v1/watch/vapid`).then((r) => (r.ok ? r.json() : null));
      if (!v?.publicKey) { setMsg("Wallet Watch is switched on at launch."); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(v.publicKey) }));
      const r = await fetch(`${PUBLIC_API_URL}/v1/watch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, subscription: sub.toJSON() }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(body.message ?? "Could not switch on Wallet Watch."); return; }
      save([...new Set([...list(), address.toLowerCase()])]); setOn(true); setMsg("Watching. This browser will tell you about new risky approvals."); track("watch_on");
    } catch { setMsg("Could not switch on Wallet Watch in this browser."); } finally { setBusy(false); }
  }
  async function stop() {
    setBusy(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) await fetch(`${PUBLIC_API_URL}/v1/watch`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint, address }) });
      save(list().filter((a) => a !== address.toLowerCase())); setOn(false); setMsg("Stopped watching this wallet.");
    } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" disabled={busy} onClick={on ? stop : start} className="btn btn-secondary min-h-10 px-4 text-[14px] disabled:opacity-50" aria-pressed={on}>
        {busy ? "One moment…" : on ? "Watching · stop" : "Watch this wallet"}
      </button>
      {msg && <span role="status" className="text-[12.5px] text-muted">{msg}</span>}
    </div>
  );
}
