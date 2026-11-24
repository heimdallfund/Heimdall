import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { parseAbi, type Address } from "viem";
import { cacheLife } from "next/cache";
import { connection } from "next/server";
import { ADDRESSES, SHIELD_API_URL, explorerAddress, explorerTx, short } from "@/lib/config";
import { client } from "@/lib/reads";
import { heimAddress } from "@/lib/heim";
import { fetchSigner } from "@/lib/shield";
import { heimdallSignalsAbi, heimdallVaultFactoryAbi } from "@/lib/abi";
import { Icon } from "@/components/Icons";
import { ScanLoader } from "@/components/Motif";

export const metadata: Metadata = { title: "Trust center", description: "Live status, signer, contracts, multisig and admin history for Heimdall." };

const SAFE = parseAbi(["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"]);
const DEPLOY_BLOCK = process.env.NEXT_PUBLIC_DEPLOY_BLOCK ? BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK) : null;
const ADMIN_EVENTS = new Set(["RolesUpdated", "CapsUpdated", "DefaultsUpdated", "HolderTermsUpdated", "OwnershipTransferred", "OwnershipTransferStarted", "TreasurySet", "FeeSet", "HolderTermsSet", "WithdrawDelaySet"]);

async function status() {
  const t0 = performance.now();
  const ok = await fetch(`${SHIELD_API_URL}/health`, { signal: AbortSignal.timeout(4000), cache: "no-store" }).then((r) => r.ok, () => false);
  return { ok, ms: Math.round(performance.now() - t0) };
}

async function governance() {
  "use cache";
  cacheLife("minutes");
  if (!ADDRESSES.factory) return null;
  try {
    const admin = (await client.readContract({ address: ADDRESSES.factory, abi: heimdallVaultFactoryAbi, functionName: "vaultAdmin" })) as Address;
    const [owners, threshold] = await Promise.all([
      client.readContract({ address: admin, abi: SAFE, functionName: "getOwners" }).catch(() => [] as readonly Address[]),
      client.readContract({ address: admin, abi: SAFE, functionName: "getThreshold" }).catch(() => 0n),
    ]);
    return { admin, owners: [...owners], threshold: Number(threshold) };
  } catch {
    return null;
  }
}

async function history() {
  "use cache";
  cacheLife("minutes");
  if (!DEPLOY_BLOCK || !ADDRESSES.factory) return null;
  const out: { name: string; contract: string; block: bigint; tx: string }[] = [];
  try {
    const latest = await client.getBlockNumber();
    const step = 500_000n;
    for (let from = DEPLOY_BLOCK, i = 0; from <= latest && i < 40; from += step, i++) {
      const to = from + step - 1n > latest ? latest : from + step - 1n;
      const [f, s] = await Promise.all([
        client.getContractEvents({ address: ADDRESSES.factory, abi: heimdallVaultFactoryAbi, fromBlock: from, toBlock: to }),
        ADDRESSES.signals ? client.getContractEvents({ address: ADDRESSES.signals, abi: heimdallSignalsAbi, fromBlock: from, toBlock: to }) : Promise.resolve([]),
      ]);
      for (const l of [...f.map((x) => ({ ...x, c: "Factory" })), ...s.map((x) => ({ ...x, c: "Signals" }))]) {
        if (ADMIN_EVENTS.has(l.eventName)) out.push({ name: l.eventName, contract: l.c, block: l.blockNumber ?? 0n, tx: l.transactionHash ?? "" });
      }
    }
    return out.sort((a, b) => Number(b.block - a.block)).slice(0, 30);
  } catch {
    return null;
  }
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-4 first:border-t-0"><span className="text-[14px] text-muted">{k}</span><span className="text-[14px]">{children}</span></div>;
}
const Addr = ({ a }: { a?: string }) => (a ? <a href={explorerAddress(a)} className="font-mono hover:text-brand">{short(a)}</a> : <span className="text-muted">Published at launch</span>);

async function Live() {
  await connection(); // live status is per request
  const [st, signer, gov, hist, heim] = await Promise.all([status(), fetchSigner(), governance(), history(), heimAddress()]);
  return (
    <>
      <section className="grid gap-5 md:grid-cols-3">
        {[
          ["Shield API", st.ok ? "Operational" : "Not reachable", st.ok ? "allow" : "muted", st.ok ? `${st.ms} ms from this server` : "Goes live with the launch"],
          ["Receipt signer", signer?.address ? short(signer.address) : "—", "ink", "Server-held key, encrypted at rest; rotated by the multisig"],
          ["Admin", gov ? `${gov.threshold || "?"}-of-${gov.owners.length || "?"} multisig` : "Safe multisig", "ink", "Owns factory, Signals and every vault"],
        ].map(([k, v, t, d]) => (
          <div key={k} className="card p-6"><div className="text-[13px] text-muted">{k}</div><div className={`mt-2 flex items-center gap-2 text-[22px] font-semibold ${t === "allow" ? "text-allow" : t === "muted" ? "text-muted" : ""}`}>{t === "allow" && <span className="size-2.5 rounded-full bg-allow" />}{v}</div><div className="mt-1 text-[13px] text-muted">{d}</div></div>
        ))}
      </section>
      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-6 py-4 text-[18px] font-semibold">Contracts · Robinhood Chain (4663)</h2>
        <Row k="HeimdallVaultFactory"><Addr a={ADDRESSES.factory} /></Row>
        <Row k="HeimdallSignals"><Addr a={ADDRESSES.signals} /></Row>
        <Row k="HeimdallPay"><Addr a={ADDRESSES.pay} /></Row>
        <Row k="HeimdallAutoInvest"><Addr a={ADDRESSES.autoInvest} /></Row>
        <Row k="HeimdallStaking"><Addr a={ADDRESSES.staking} /></Row>
        <Row k="HeimdallFeeSplitter"><Addr a={ADDRESSES.splitter} /></Row>
        <Row k="$HEIM"><Addr a={heim} /></Row>
        <Row k="USDG (Paxos)"><Addr a={ADDRESSES.usdg} /></Row>
        <Row k="Shield receipt signer"><Addr a={signer?.address} /></Row>
      </section>
      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-6 py-4 text-[18px] font-semibold">Multisig</h2>
        {gov ? (<>
          <Row k="Safe"><Addr a={gov.admin} /></Row>
          <Row k="Threshold"><span className="font-mono">{gov.threshold} of {gov.owners.length}</span></Row>
          {gov.owners.map((o, i) => <Row key={o} k={`Signer ${i + 1}`}><Addr a={o} /></Row>)}
        </>) : <p className="px-6 py-6 text-[14px] text-muted">Signers and threshold are read live from the Safe once the contracts are deployed.</p>}
      </section>
      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-6 py-4 text-[18px] font-semibold">Admin change history</h2>
        {hist && hist.length ? (
          <ul>{hist.map((h, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-3 text-[14px] first:border-t-0"><span><span className="font-semibold">{h.name}</span> <span className="text-muted">· {h.contract}</span></span><a href={explorerTx(h.tx)} className="font-mono text-[13px] text-muted hover:text-brand">block {h.block.toString()} ↗</a></li>)}</ul>
        ) : <p className="px-6 py-6 text-[14px] text-muted">Every admin action (caps, allowed calls, feeds, signer, ownership) is an onchain event and will be listed here from the deployment block.</p>}
      </section>
    </>
  );
}

export default function TrustPage() {
  return (
    <div className="mx-auto flex max-w-[1040px] flex-col gap-6 px-6 pb-24 pt-14">
      <header className="flex flex-wrap items-end justify-between gap-6 pb-2">
        <div className="max-w-[640px]">
          <span className="eyebrow">Trust center</span>
          <h1 className="mt-2 text-[50px] md:text-[62px]">Everything you need to verify us</h1>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">Live status, the keys that sign receipts, the contracts, the multisig that owns them, and every admin change, read straight from Robinhood Chain.</p>
        </div>
        <Link href="/security" className="btn btn-secondary">Security review <Icon name="arrow" size={16} /></Link>
      </header>
      <Suspense fallback={<ScanLoader label="Reading Robinhood Chain…" />}><Live /></Suspense>
    </div>
  );
}
