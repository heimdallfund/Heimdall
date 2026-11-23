const FACETS = [
  "32,4 9,12 32,30", "32,4 55,12 32,30", "9,12 9,30 32,30",
  "55,12 55,30 32,30", "9,30 32,60 32,30", "55,30 32,60 32,30",
];
const COLOR = ["#7C95FF", "#3355FF", "#5C78FF", "#1F3FE0", "#4A68FF", "#2A49F0"];
const WHITE = ["#FFFFFF", "#D6DEFF", "#EAEFFF", "#AFC0FF", "#C7D3FF", "#9DB1FF"];

/** Heimdall "Facet Shield" mark. `onBrand` = the white version for cobalt backgrounds. */
export function LogoMark({ size = 32, onBrand = false, className }: { size?: number; onBrand?: boolean; className?: string }) {
  const fills = onBrand ? WHITE : COLOR;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      {FACETS.map((p, i) => (
        <polygon key={p} points={p} fill={fills[i]} stroke={onBrand ? "#3355FF" : "#FFFFFF"} strokeWidth="0.8" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

export function Logo({ size = 32, compact = false, light = false }: { size?: number; compact?: boolean; light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className={`font-brand text-[20px] font-semibold tracking-[-0.02em] ${light ? "text-paper" : "text-ink"} ${compact ? "hidden min-[360px]:inline" : ""}`}>Heimdall</span>
    </span>
  );
}
