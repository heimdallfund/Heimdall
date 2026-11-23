import type { ReactNode } from "react";
import { AppNav } from "@/components/AppNav";
import { Providers } from "@/components/Providers";

/** dApp area: its own sidebar, separate from the marketing pages. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-5 md:px-8 lg:flex-row lg:gap-10">
      <aside className="border-b border-line py-3 lg:sticky lg:top-[64px] lg:h-[calc(100vh-64px)] lg:w-[220px] lg:shrink-0 lg:border-b-0 lg:border-r lg:py-8 lg:pr-4">
        <AppNav />
      </aside>
      <div className="min-w-0 flex-1 pb-16"><Providers>{children}</Providers></div>
    </div>
  );
}
