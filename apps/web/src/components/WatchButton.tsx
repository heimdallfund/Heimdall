"use client";
import { useEffect, useState } from "react";
import { PUBLIC_API_URL } from "@/lib/config";
import { track } from "@/lib/track";

const KEYS = { wallet: "heimdall-watching", token: "heimdall-watching-tokens" } as const;
const TEXT = {
  wallet: { path: "/v1/watch", field: "address", off: "Watch this wallet", on: "Watching. This browser will tell you about new risky approvals.", stopped: "Stopped watching this wallet.", fail: "Could not switch on Wallet Watch.", later: "Wallet Watch is switched on at launch." },
  token: { path: "/v1/watch/token", field: "token", off: "Watch this token", on: "Watching. This browser will tell you if the dev sells, liquidity is pulled, a wallet dumps, or the check gets worse.", stopped: "Stopped watching this token.", fail: "Could not switch on Token Watch.", later: "Token Watch is not switched on yet." },
} as const;
const b64ToBytes = (b64: string) => { const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
const list = (k: string): string[] => { try { return JSON.parse(localStorage.getItem(k) ?? "[]"); } catch { return []; } };
const save = (k: string, l: string[]) => { try { localStorage.setItem(k, JSON.stringify(l)); } catch {} };

/**
 * Wallet Watch: a browser notification when this wallet gains a new risky approval. Token Watch: when a token's dev
 * sells, liquidity is pulled, a wallet dumps, or its Token Check gets worse. No account, no email.
 */
export function WatchButton({ address, kind = "wallet" }: { address: string; kind?: "wallet" | "token" }) {
  const KEY = KEYS[kind], T = TEXT[kind];
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    setSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
    setOn(list(KEY).includes(address.toLowerCase()));
  }, [address, KEY]);
  if (!supported) return null;

  async function start() {
    setBusy(true); setMsg(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") { setMsg("Notifications are blocked for this site in your browser settings."); return; }
      const v = await fetch(`${PUBLIC_API_URL}/v1/watch/vapid`).then((r) => (r.ok ? r.json() : null));
      if (!v?.publicKey) { setMsg(T.later); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(v.publicKey) }));
      const r = await fetch(`${PUBLIC_API_URL}${T.path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [T.field]: address, subscription: sub.toJSON() }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(body.message ?? T.fail); return; }
      save(KEY, [...new Set([...list(KEY), address.toLowerCase()])]); setOn(true); setMsg(T.on); track(kind === "token" ? "token_watch_on" : "watch_on");
    } catch { setMsg(`${T.fail} This browser may not support it.`); } finally { setBusy(false); }
  }
  async function stop() {
    setBusy(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) await fetch(`${PUBLIC_API_URL}${T.path}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint, [T.field]: address }) });
      save(KEY, list(KEY).filter((a) => a !== address.toLowerCase())); setOn(false); setMsg(T.stopped);
    } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" disabled={busy} onClick={on ? stop : start} className="btn btn-secondary min-h-10 px-4 disabled:opacity-50" aria-pressed={on}>
        {busy ? "One moment…" : on ? "Watching · stop" : T.off}
      </button>
      {msg && <span role="status" className="text-[12.5px] text-muted">{msg}</span>}
    </div>
  );
}
