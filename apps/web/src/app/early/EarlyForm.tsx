"use client";
import { useEffect, useState } from "react";
import { useShieldSession } from "@/lib/useShieldSession";
import { ConnectButton } from "@/components/ConnectButton";
import { clearRef, inviteUrl, loadRef, shareOnX } from "@/lib/referral";
import { short } from "@/lib/config";
import { track } from "@/lib/track";

type Done = { already: boolean; code: string; points?: number; referral?: { ok: boolean; reason?: string } };

export function EarlyForm() {
  const { address, session, signIn, api } = useShieldSession();
  const [ref, setRef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setRef(loadRef()); }, []);
  useEffect(() => { setDone(null); setErr(null); }, [address]);

  async function join() {
    setBusy(true); setErr(null);
    try {
      if (!session) await signIn();
      const r = await api("/early", { method: "POST", body: JSON.stringify({ code: ref ?? undefined }) }) as Done;
      setDone(r); if (ref) clearRef(); track("early_access");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (!address) return <div className="card flex flex-col items-start gap-3 p-6"><p className="text-[17px] font-semibold">Join with your wallet</p>{ref && <p className="text-[14px] text-allow">You were invited: your friend earns points when you use Heimdall.</p>}<ConnectButton /></div>;
  if (done) {
    const link = inviteUrl(done.code);
    return (
      <div className="card flex flex-col gap-4 p-6">
        <p className="text-[20px] font-semibold">{done.already ? "You're already on the list." : `You're in. +${done.points ?? 100} Guardian Points`}</p>
        <p className="text-[14.5px] text-muted">Your invite link. You earn 100 points for each friend who really uses Heimdall after launch.</p>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-ice px-3 py-2"><code className="min-w-0 flex-1 truncate font-mono text-[14px]">{link}</code>
          <button type="button" className="text-[14px] font-semibold text-brand" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>{copied ? "Copied" : "Copy"}</button></div>
        <a className="btn btn-primary self-start" target="_blank" rel="noopener" href={shareOnX("I'm on the Heimdall early access list: a firewall for AI agents on Robinhood Chain.", link)}>Share on X</a>
        {done.referral && !done.referral.ok && <p className="text-[13px] text-muted">The invite link you came with could not be used ({done.referral.reason?.replace(/_/g, " ")}).</p>}
      </div>
    );
  }
  return (
    <div className="card flex flex-col gap-4 p-6">
      <p className="text-[17px] font-semibold">Join as <span className="font-mono">{short(address)}</span></p>
      {ref && <p className="text-[14px] text-allow">Invite code <span className="font-mono">{ref}</span> will be linked to your wallet.</p>}
      <button type="button" disabled={busy} onClick={join} className="btn btn-primary min-h-12 self-start disabled:opacity-50">{busy ? "Check your wallet…" : session ? "Join early access" : "Sign in and join"}</button>
      {err && <p className="text-[14px] text-deny">{err}</p>}
      <p className="text-[13px] text-muted">You sign a message, not a transaction. Nothing moves and there is no gas.</p>
    </div>
  );
}
