import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { SHIELD_API_URL } from "@/lib/config";
import { LiveStatus, type Status } from "./LiveStatus";

export const metadata: Metadata = { title: "Status", description: "Live status of Heimdall Shield, the Robinhood Chain RPC, the vault monitor and the keeper: head block, response times, checks per day, 30 days of uptime and every incident." };

async function Live() {
  await connection();
  const t = Date.now();
  const s = await fetch(`${SHIELD_API_URL}/v1/status`, { signal: AbortSignal.timeout(6_000), cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<Status>) : null))
    .then((x) => (x ? { ...x, shieldMs: Date.now() - t } : null))
    .catch(() => null);
  return <LiveStatus initial={s} />;
}

export default function StatusPage() {
  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-8 px-6 pb-24 pt-12">
      <header className="flex flex-col gap-2"><span className="eyebrow">Trust</span><h1 className="text-[50px]">Status</h1>
        <p className="text-muted">Live, refreshed every 15 seconds. Contracts on Robinhood Chain keep working whatever this page says: deposits, escrow and staking do not depend on Heimdall&apos;s servers, and in-kind exits always work.</p></header>
      <Suspense fallback={<div className="card h-24 animate-pulse" />}><Live /></Suspense>
    </div>
  );
}
