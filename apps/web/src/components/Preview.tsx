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
