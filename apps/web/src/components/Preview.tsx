import { Icon } from "./Icons";

export function PreviewBadge() {
  return <span className="inline-flex items-center gap-1 rounded-sm border border-brand/25 bg-brand-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-brand">Preview</span>;
}

export function LaunchBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border border-ink border-l-4 border-l-brand bg-panel px-4 py-3 text-[14.5px] leading-relaxed text-ink">
      <Icon name="sparkle" className="mt-0.5 shrink-0 text-brand" size={18} />
      <div>{children}</div>
    </div>
  );
}

/** Honest status for pages where money goes into a contract: reviewed and tested, not yet independently audited, capped. */
export function AuditNotice({ cap }: { cap?: string }) {
  return (
    <p className="border border-warn/40 bg-warn-soft px-3.5 py-2 text-[13px] leading-relaxed text-ink">
      <span className="mr-1.5 font-mono text-[11.5px] font-bold uppercase tracking-wider text-warn">Not yet audited</span>
      Six internal reviews, fuzzing and static analysis are done; the independent audit is next.{cap ? ` ${cap}` : ""} Only put in what you can afford to lose.{" "}
      <a href="/security#audit" className="font-semibold underline hover:text-brand">Security</a>
    </p>
  );
}
