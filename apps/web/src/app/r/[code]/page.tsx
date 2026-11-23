import type { Metadata } from "next";
import { Suspense } from "react";
import { SaveInvite } from "./SaveInvite";

export const metadata: Metadata = { title: "You're invited to Heimdall", description: "The guardian layer for AI agents on Robinhood Chain.", robots: { index: false } };

export default function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center gap-4 px-6 py-24 text-center">
      <h1 className="text-[40px]">You&apos;re invited to Heimdall</h1>
      <p className="text-muted">Taking you there…</p>
      <Suspense fallback={null}><SaveInvite params={params} /></Suspense>
    </div>
  );
}
