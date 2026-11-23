/** Heimdall's signature motif: a facet from the logo on a hairline, with a slow scan light. */
export function FacetDivider({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`mx-auto flex max-w-[1280px] items-center gap-3 px-6 ${className}`}>
      <span className="size-2 bg-brand" />
      <span className="h-px flex-1 bg-ink/20" />
      <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted">Heimdall · Robinhood Chain</span>
      <span className="h-px flex-1 bg-ink/20" />
      <span className="size-2 bg-brand" />
    </div>
  );
}

/** Loading state: the mark being scanned. */
export function ScanLoader({ label = "Checking onchain…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-4 py-16">
      <div className="relative h-[66px] w-[60px] overflow-hidden">
        <svg width="60" height="66" viewBox="0 0 64 64" aria-hidden="true"><polygon points="32,4 9,12 32,30" fill="#C9D2F5" /><polygon points="32,4 55,12 32,30" fill="#AEBBF5" /><polygon points="9,12 9,30 32,30" fill="#BCC7F5" /><polygon points="55,12 55,30 32,30" fill="#9EAEF2" /><polygon points="9,30 32,60 32,30" fill="#B3C0F5" /><polygon points="55,30 32,60 32,30" fill="#A3B3F3" /></svg>
        <span className="scanner absolute inset-x-0 h-4 bg-gradient-to-b from-transparent via-brand/50 to-transparent" />
      </div>
      <span className="text-[14px] text-muted">{label}</span>
    </div>
  );
}
