import type { ReactNode } from "react";
import { DocsMobileMenu, DocsPager, DocsSidebar, DocsToc } from "@/components/docs/DocsChrome";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[1400px] gap-10 px-5 md:px-8">
      <aside className="sticky top-[65px] hidden h-[calc(100vh-65px)] w-[250px] shrink-0 overflow-y-auto border-r border-line py-8 pr-4 lg:block">
        <DocsSidebar />
      </aside>
      <div className="flex min-w-0 flex-1 gap-10 pb-20 pt-6 lg:pt-10">
        <div className="flex min-w-0 max-w-[760px] flex-1 flex-col gap-6">
          <DocsMobileMenu />
          <article className="docs-prose flex min-w-0 flex-col gap-5 text-[15.5px] leading-[1.75] text-ink/90">{children}</article>
          <DocsPager />
        </div>
        <aside className="sticky top-[105px] hidden h-fit w-[200px] shrink-0 xl:block"><DocsToc /></aside>
      </div>
    </div>
  );
}
