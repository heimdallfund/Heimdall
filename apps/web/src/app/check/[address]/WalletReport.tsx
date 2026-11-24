"use client";
import { track } from "@/lib/track";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { parseAbi, type Address } from "viem";
import { ConnectButton } from "@/components/ConnectButton";
import { WatchButton } from "@/components/WatchButton";
import { Icon } from "@/components/Icons";
import { ScanLoader } from "@/components/Motif";
import { explorerAddress, short } from "@/lib/config";
import { TokenIcon } from "@/components/TokenIcon";

type Risk = "danger" | "review" | "ok";
interface Row { kind: "erc20" | "all" | "permit2"; token: Address; symbol: string; spender: Address; spenderLabel: string | null; spenderIsContract: boolean; allowance: string; unlimited: boolean; expiresAt: number | null; atRiskUsd: number | null; risk: Risk; reasons: string[] }
interface TokenFlag { token: Address; symbol: string; balance: string; risk: "danger" | "review"; code: string; reason: string }
interface Report { owner: Address; approvals: Row[]; summary: { total: number; danger: number; review: number; atRiskUsd: number }; complete: boolean; progress: number; tokens?: TokenFlag[]; tokensChecked?: number }
const TOKEN_LABEL: Record<string, string> = { FAKE_TOKEN: "Fake token", BLOCKLISTED_TOKEN: "Blocklisted", HONEYPOT: "Honeypot", VANISHING_TOKEN: "Can vanish", ALLOWANCE_BYPASS: "Can be pulled", TRANSFER_BLOCKED: "Cannot transfer", BLOCKLISTED_CONTRACT: "Blocklisted" };
const amount = (v: string) => { const n = Number(v); return n >= 1e9 ? n.toExponential(2) : n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 }); };

const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
const ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function lockdown((address token, address spender)[] approvals)",
]);
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 });
const TONE: Record<Risk, string> = { danger: "bg-deny-soft text-deny", review: "bg-warn-soft text-warn", ok: "bg-allow-soft text-allow" };
const LABEL: Record<Risk, string> = { danger: "Danger", review: "Review", ok: "OK" };

export function score(s: Report["summary"]) { return Math.max(0, Math.min(100, 100 - s.danger * 35 - s.review * 8)); }

export function WalletReport({ address }: { address: Address }) {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const polls = useRef(0);
  const { address: me } = useAccount();
  const pc = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const own = !!me && me.toLowerCase() === address.toLowerCase();

  const load = useCallback(async (refresh = false) => {
    try {
      const res = await fetch(`/api/wallet/${address}${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) { setErr(j.message ?? "Wallet Check is unavailable right now."); return; }
      setR(j); setErr(null);
    } catch { setErr("Wallet Check is unavailable right now."); }
  }, [address]);
  useEffect(() => { polls.current = 0; setR(null); load(); }, [load]);
  useEffect(() => { // keep scanning history until complete
    if (!r || r.complete || polls.current > 40) return;
    const t = setTimeout(() => { polls.current++; load(true); }, 2500);
    return () => clearTimeout(t);
  }, [r, load]);

  async function revoke(row: Row) {
    if (!pc) return;
    const id = `${row.token}|${row.spender}`;
    setBusy(id); setToast(null);
    try {
      const hash = row.kind === "erc20" ? await writeContractAsync({ address: row.token, abi: ABI, functionName: "approve", args: [row.spender, 0n] })
        : row.kind === "all" ? await writeContractAsync({ address: row.token, abi: ABI, functionName: "setApprovalForAll", args: [row.spender, false] })
        : await writeContractAsync({ address: PERMIT2, abi: ABI, functionName: "lockdown", args: [[{ token: row.token, spender: row.spender }]] });
      await pc.waitForTransactionReceipt({ hash });
      track("revoke");
      const claim = await fetch("/api/points/revoke", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: address, txHash: hash }) }).then((x) => x.json()).catch(() => null);
      setToast(claim?.awarded ? `Revoked. +${claim.awarded} Guardian Points` : "Revoked.");
      await load(true);
    } catch (e) {
      setToast((e as { shortMessage?: string }).shortMessage ?? "Revoke cancelled.");
    } finally { setBusy(null); }
  }
  async function revokeAllRisky() { for (const row of (r?.approvals ?? []).filter((x) => x.risk !== "ok")) await revoke(row); }

  if (err && !r) return <div role="alert" className="card flex items-center gap-3 p-6 text-[15px]"><Icon name="alert" className="text-warn" />{err}</div>;
  if (!r) return <div className="card flex flex-col items-center gap-4 p-10 text-center"><ScanLoader /><p className="text-[15px] text-muted">Reading every approval this wallet has given…</p></div>;

  const flags = r.tokens ?? [];
  const badTokens = flags.filter((t) => t.risk === "danger").length;
  const sc = Math.max(0, score(r.summary) - badTokens * 15 - (flags.length - badTokens) * 5);
  const risky = r.approvals.filter((x) => x.risk !== "ok");
  const shareText = encodeURIComponent(`My Robinhood Chain wallet scores ${sc}/100 on Heimdall Wallet Check${risky.length ? `, ${risky.length} risky approval${risky.length > 1 ? "s" : ""} found` : ", no risky approvals"}. Check yours:`);
  const shareUrl = encodeURIComponent(typeof window === "undefined" ? "" : `${location.origin}/check`);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="card flex min-w-0 flex-col gap-1 p-4 sm:p-5"><span className="text-[13px] text-muted">Safety score</span><span className={`font-mono text-[26px] font-semibold sm:text-[34px] ${sc >= 90 ? "text-allow" : sc >= 60 ? "text-warn" : "text-deny"}`}>{sc}<span className="text-[15px] text-muted sm:text-[18px]">/100</span></span></div>
        <div className="card flex min-w-0 flex-col gap-1 p-4 sm:p-5"><span className="text-[13px] text-muted">Dangerous approvals</span><span className="font-mono text-[26px] font-semibold sm:text-[34px] text-deny">{r.summary.danger}</span></div>
        <div className="card flex min-w-0 flex-col gap-1 p-4 sm:p-5"><span className="text-[13px] text-muted">To review</span><span className="font-mono text-[26px] font-semibold sm:text-[34px] text-warn">{r.summary.review}</span></div>
        <div className="card flex min-w-0 flex-col gap-1 p-4 sm:p-5"><span className="text-[13px] text-muted">Value at risk</span><span className="font-mono text-[26px] font-semibold sm:text-[34px]">{usd(r.summary.atRiskUsd)}</span></div>
      </section>

      {!r.complete && <div className="flex items-center gap-3 rounded-xl border border-brand/20 bg-brand-soft/60 px-4 py-3 text-[14.5px]"><span className="inline-block size-2 animate-pulse rounded-full bg-brand" />Scanning older history: {r.progress}% done. Results update by themselves.</div>}
      {toast && <div role="status" className="rounded-xl border border-allow/30 bg-allow-soft px-4 py-3 text-[14.5px] font-medium text-allow">{toast}</div>}

      {flags.length > 0 && (
        <section className="card min-w-0 overflow-hidden" aria-labelledby="held-tokens">
          <div className="border-b border-line px-5 py-4">
            <h2 id="held-tokens" className="text-[17px] font-semibold">{flags.length} suspicious token{flags.length === 1 ? "" : "s"} in this wallet</h2>
            <p className="mt-0.5 text-[14px] text-muted">Tokens like these are often airdropped as bait. Do not swap, approve or send them, and never buy more.</p>
          </div>
          <ul className="divide-y divide-line">
            {flags.map((t) => (
              <li key={t.token} className="grid min-w-0 gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] md:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`shrink-0 rounded-sm px-2.5 py-1 text-[12px] font-semibold ${TONE[t.risk]}`}>{TOKEN_LABEL[t.code] ?? LABEL[t.risk]}</span>
                  <TokenIcon symbol={t.symbol} size={30} plain />
                  <div className="min-w-0"><div className="truncate text-[15px] font-semibold">{t.symbol}</div><div className="truncate font-mono text-[13px] text-muted">{amount(t.balance)} held</div></div>
                </div>
                <p className="min-w-0 break-words text-[14px] text-muted [overflow-wrap:anywhere]">{t.reason}</p>
                <Link href={`/token-check/${t.token}`} className="btn btn-secondary min-h-10 justify-self-start px-4 md:justify-self-end">Full report</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-[17px] font-semibold">{r.summary.total} live approval{r.summary.total === 1 ? "" : "s"}</h2>
          <div className="flex flex-wrap gap-2">
            {own && risky.length > 1 && <button type="button" disabled={!!busy} onClick={revokeAllRisky} className="btn btn-primary min-h-10 px-4 disabled:opacity-50">Revoke all risky ({risky.length})</button>}
            <WatchButton address={r.owner} />
            <a href={`https://x.com/intent/tweet?text=${shareText}&url=${shareUrl}`} target="_blank" rel="noopener" className="btn btn-secondary min-h-10 px-4">Share score</a>
          </div>
        </div>
        {r.approvals.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center"><span className="inline-flex size-12 items-center justify-center rounded-full bg-allow-soft text-allow"><Icon name="check" /></span><p className="text-[16px] font-semibold">No live approvals found</p><p className="max-w-[420px] text-[14.5px] text-muted">Nothing can move tokens out of this wallet without a new signature.</p></div>
        ) : (
          <ul className="divide-y divide-line">
            {r.approvals.map((row) => {
              const id = `${row.token}|${row.spender}`;
              return (
                <li key={`${row.kind}|${id}`} className="grid min-w-0 gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto] md:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`shrink-0 rounded-sm px-2.5 py-1 text-[12px] font-semibold ${TONE[row.risk]}`}>{LABEL[row.risk]}</span>
                    <TokenIcon symbol={row.symbol} size={30} />
                    <div className="min-w-0"><div className="truncate text-[15px] font-semibold">{row.symbol} <span className="font-mono text-[13px] font-medium text-muted">{row.kind === "all" ? "all tokens" : row.allowance}</span></div>
                      <div className="text-[13px] text-muted">{row.kind === "permit2" ? "via Permit2" : row.kind === "all" ? "operator approval" : "token approval"}{row.atRiskUsd ? ` · ${usd(row.atRiskUsd)} exposed` : ""}</div></div>
                  </div>
                  <div className="min-w-0 text-[14px]">
                    <a href={explorerAddress(row.spender)} target="_blank" rel="noopener" className="font-medium hover:underline">{row.spenderLabel ?? short(row.spender)}</a>
                    {!row.spenderIsContract && !row.spenderLabel && <span className="ml-2 rounded bg-deny-soft px-1.5 py-0.5 text-[11px] font-semibold text-deny">WALLET</span>}
                    <p className="mt-0.5 text-[13px] text-muted">{row.reasons[0]}</p>
                  </div>
                  <div className="flex justify-start md:justify-end">
                    {own ? <button type="button" disabled={!!busy} onClick={() => revoke(row)} className={`min-h-10 rounded-lg px-4 text-[14px] font-semibold disabled:opacity-50 ${row.risk === "ok" ? "border border-line text-ink hover:bg-ink-2" : "bg-deny text-white hover:opacity-90"}`}>{busy === id ? "Revoking…" : "Revoke"}</button> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!own && (risky.length > 0) && (
        <div className="card flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-[16px] font-semibold">Is this your wallet?</p><p className="text-[14.5px] text-muted">Connect it to revoke risky approvals and earn {50} Guardian Points for each one.</p></div>
          <ConnectButton />
        </div>
      )}
      {!!r.tokensChecked && flags.length === 0 && <p className="flex items-center gap-2 text-[14px] text-muted"><Icon name="check" className="text-allow" />{r.tokensChecked} held token{r.tokensChecked === 1 ? "" : "s"} checked for fakes, blocklisted tokens and traps: none flagged.</p>}
      <p className="text-[13px] text-muted">Revoking sends one transaction per approval from your wallet. Heimdall never holds your keys. <Link href="/points" className="font-medium text-brand hover:underline">How Guardian Points work</Link></p>
    </div>
  );
}
