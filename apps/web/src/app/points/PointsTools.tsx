"use client";
import { track } from "@/lib/track";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { PUBLIC_API_URL, short } from "@/lib/config";
import { ConnectButton } from "@/components/ConnectButton";
import { useShieldSession } from "@/lib/useShieldSession";
import { inviteUrl } from "@/lib/referral";

interface Mine { total: number; rank: number | null; breakdown: Record<"revoke" | "report" | "deposit" | "checks" | "early" | "referral" | "action", number>; log: { at: number; reason: string; points: number }[] }
interface Invites { code: string; invited: number; qualified: number; points: number; cap: number }
const REASON: Record<string, string> = { revoke: "Revoked a risky approval", report: "Drainer report confirmed", deposit: "Vault deposit", checks: "Shield checks", early: "Early access", referral: "Invite", action: "First stake or Pay job" };

export function MyPoints() {
  const { address } = useAccount();
  const [m, setM] = useState<Mine | null>(null);
  const [inv, setInv] = useState<Invites | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!address) { setM(null); setInv(null); return; }
    fetch(`${PUBLIC_API_URL}/v1/points/${address}`).then((r) => (r.ok ? r.json() : null)).then(setM).catch(() => setM(null));
    fetch(`${PUBLIC_API_URL}/v1/referrals/${address}`).then((r) => (r.ok ? r.json() : null)).then(setInv).catch(() => setInv(null));
  }, [address]);
  if (!address) return <div className="card flex flex-col items-start gap-3 p-6"><p className="text-[16px] font-semibold">Your points</p><p className="text-[14.5px] text-muted">Connect a wallet to see your points and rank.</p><ConnectButton /></div>;
  return (
    <div className="card flex flex-col gap-4 p-6">
      <div className="flex items-baseline justify-between"><p className="text-[16px] font-semibold">Your points · <span className="font-mono text-[14px] text-muted">{short(address)}</span></p>{m?.rank && <span className="font-mono text-[14px] text-muted">rank #{m.rank}</span>}</div>
      <p className="font-mono text-[44px] font-semibold leading-none text-brand">{(m?.total ?? 0).toLocaleString("en-US")}</p>
      <div className="grid grid-cols-2 gap-2 text-[14px]">
        {(["revoke", "report", "deposit", "checks", "early", "referral", "action"] as const).filter((k) => k !== "early" || (m?.breakdown.early ?? 0) > 0).map((k) => <div key={k} className="flex justify-between rounded-lg bg-ink-2 px-3 py-2"><span className="text-muted">{({ revoke: "Revokes", report: "Reports", deposit: "Deposits", checks: "Checks", early: "Early access", referral: "Invites", action: "First use" } as const)[k]}</span><span className="font-mono">{m?.breakdown[k] ?? 0}</span></div>)}
      </div>
      {m?.log.length ? <ul className="flex flex-col gap-1.5 text-[13.5px]">{m.log.slice(0, 5).map((l, i) => <li key={i} className="flex justify-between"><span className="text-muted">{REASON[l.reason] ?? l.reason}</span><span className="font-mono text-allow">+{l.points}</span></li>)}</ul>
        : <p className="text-[14px] text-muted">No points yet. Start with a <a href={`/check/${address}`} className="font-medium text-brand hover:underline">Wallet Check</a>.</p>}
      {inv && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-[14.5px] font-semibold">Invite friends · {inv.qualified} of {inv.invited} active</p>
          <p className="text-[13.5px] text-muted">100 points per friend who stakes, pays for a job, holds in a vault or files a confirmed report. Up to {inv.cap} per season.</p>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-ice px-3 py-2"><code className="min-w-0 flex-1 truncate font-mono text-[13.5px]">{inviteUrl(inv.code)}</code>
            <button type="button" className="text-[13.5px] font-semibold text-brand" onClick={async () => { try { await navigator.clipboard.writeText(inviteUrl(inv.code)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>{copied ? "Copied" : "Copy"}</button></div>
        </div>
      )}
    </div>
  );
}

export function ReportForm() {
  const { address, session, signIn, api } = useShieldSession();
  const [target, setTarget] = useState(""); const [evidence, setEvidence] = useState(""); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setBusy(true);
    try {
      if (!session) await signIn();
      await api("/reports", { method: "POST", body: JSON.stringify({ address: target.trim(), evidence: evidence.trim(), note: note.trim() || undefined }) });
      track("report_submitted");
      setMsg({ ok: true, text: "Report received. You earn 200 points if a reviewer confirms it." }); setTarget(""); setEvidence(""); setNote("");
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="card flex flex-col gap-4 p-6">
      <div><p className="text-[16px] font-semibold">Report a drainer</p><p className="mt-1 text-[14.5px] text-muted">Seen an address stealing funds on Robinhood Chain? Confirmed reports join the Heimdall blocklist, so every agent and wallet using Shield is protected.</p></div>
      <label className="flex flex-col gap-1.5 text-[14px] font-medium">Address<input required value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0x…" spellCheck={false} className="min-h-11 rounded-lg border border-line px-3 font-mono text-[14px] outline-none focus:border-brand" /></label>
      <label className="flex flex-col gap-1.5 text-[14px] font-medium">Evidence link<input required type="url" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="https://… a transaction, post or page that shows the theft" className="min-h-11 rounded-lg border border-line px-3 text-[14px] outline-none focus:border-brand" /></label>
      <label className="flex flex-col gap-1.5 text-[14px] font-medium">Note (optional)<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="rounded-lg border border-line px-3 py-2 text-[14px] outline-none focus:border-brand" /></label>
      {address ? <button type="submit" disabled={busy} className="btn btn-primary min-h-11 self-start px-5 disabled:opacity-50">{busy ? "Check your wallet…" : session ? "Send report" : "Sign in and send"}</button> : <ConnectButton />}
      {msg && <p role="status" className={`text-[14px] ${msg.ok ? "text-allow" : "text-deny"}`}>{msg.text}</p>}
    </form>
  );
}
