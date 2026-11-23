import type { Metadata } from "next";
import { AdminPanel } from "./AdminPanel";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-8 px-6 pb-24 pt-10">
      <header className="flex flex-col gap-2">
        <span className="eyebrow">Operations</span>
        <h1 className="text-[36px] font-bold tracking-[-0.03em]">Admin</h1>
        <p className="text-muted">Drainer reports, the community blocklist, Agent Arena seasons, keeper queues and product analytics. The key stays in this browser tab only.</p>
      </header>
      <AdminPanel />
    </div>
  );
}
