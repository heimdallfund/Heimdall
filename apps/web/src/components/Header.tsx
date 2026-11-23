"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import dynamic from "next/dynamic";

const HeaderWallet = dynamic(() => import("./HeaderWallet"), { ssr: false, loading: () => <span className="inline-block h-10 w-[132px] bg-ice" /> });
import { Search } from "./Search";

const LINKS: { href: string; label: string; match: string[] }[] = [
  { href: "/check", label: "Wallet check", match: ["/check"] },
  { href: "/shield", label: "Agents", match: ["/shield", "/app"] },
  { href: "/vaults", label: "Vaults", match: ["/vaults", "/agents"] },
  { href: "/signals", label: "Signals", match: ["/signals"] },
  { href: "/pay", label: "Pay", match: ["/pay"] },
  { href: "/arena", label: "Arena", match: ["/arena"] },
  { href: "/integrate", label: "Integrate", match: ["/integrate", "/oracle", "/guard", "/x402", "/passport"] },
  { href: "/docs", label: "Docs", match: ["/docs"] },
];

export function Header() {
  const path = usePathname();
  return <HeaderView path={path} />;
}

/** Static shell used while the pathname streams in (and for prerendering). */
export function HeaderFallback() {
  return <HeaderView path="" />;
}

function HeaderView({ path }: { path: string }) {
  const inApp = path.startsWith("/app");
  const [mobile, setMobile] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => { setMobile(false); }, [path]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMobile(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  return (
    <header className={`sticky top-0 z-40 border-b transition-colors ${scrolled || mobile ? "border-ink/15 bg-paper/90 backdrop-blur" : "border-transparent bg-paper/0"}`}>
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-[1280px] items-center gap-2 px-4 sm:gap-5 sm:px-5 md:px-6">
        <Link href="/" aria-label="Heimdall home" className="shrink-0"><Logo compact={inApp} /></Link>
        <div className="hidden items-center gap-1 whitespace-nowrap font-mono text-[12px] font-semibold uppercase tracking-[0.08em] xl:mx-auto xl:flex">
          {LINKS.map((l) => {
            const active = l.match.some((m) => path === m || path.startsWith(`${m}/`));
            return <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={`relative inline-flex min-h-10 items-center px-2.5 transition-colors ${active ? "text-ink after:absolute after:inset-x-2.5 after:-bottom-px after:h-[2px] after:bg-brand" : "text-ink/60 hover:text-ink"}`}>{l.label}</Link>;
          })}
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2 xl:ml-0">
          <Search />
          {inApp ? <HeaderWallet /> : <span className="hidden sm:inline-flex"><Link href="/app/shield" className="btn btn-primary min-h-10 whitespace-nowrap px-4 shadow-none hover:shadow-[3px_3px_0_var(--color-ink)]">Launch app</Link></span>}
          <button type="button" aria-label="Menu" aria-expanded={mobile} onClick={() => setMobile((v) => !v)} className="inline-flex size-10 shrink-0 items-center justify-center border border-ink bg-panel xl:hidden">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">{mobile ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}</svg>
          </button>
        </div>
      </nav>
      {mobile && (
        <div className="menu-in max-h-[calc(100vh-64px)] overflow-y-auto border-t border-ink/15 bg-paper px-5 pb-6 pt-2 xl:hidden">
          <div className="flex flex-col py-2">
            {[...LINKS, { href: "/token", label: "$HEIM", match: [] }, { href: "/points", label: "Points", match: [] }].filter((l, i, a) => a.findIndex((x) => x.href === l.href) === i).map((l, i) => (
              <Link key={l.href} href={l.href} className="flex items-baseline gap-4 border-b border-line py-3">
                <span className="font-mono text-[11px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                <span className="display text-[30px]">{l.label}</span>
              </Link>
            ))}
          </div>
          <Link href="/app/shield" className="btn btn-primary mt-4 w-full">Launch app →</Link>
        </div>
      )}
    </header>
  );
}
