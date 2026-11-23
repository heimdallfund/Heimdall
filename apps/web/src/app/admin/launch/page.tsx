import type { Metadata } from "next";
import Link from "next/link";
import { LaunchChecklist } from "./LaunchChecklist";

export const metadata: Metadata = { title: "Launch day", robots: { index: false, follow: false } };

export default function LaunchPage() {
  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-8 px-5 pb-24 pt-10">
      <header className="flex flex-col gap-2">
        <span className="eyebrow">Operations</span>
        <h1 className="text-[36px] font-bold tracking-[-0.03em]">Launch day</h1>
        <p className="text-muted">Every step from deploy to open doors, in order. Tick each one as it is done; times are in UTC. Full commands and emergency steps are in the runbook. <Link href="/admin" className="font-medium text-brand hover:underline">Back to admin</Link></p>
      </header>
      <LaunchChecklist />
    </div>
  );
}
