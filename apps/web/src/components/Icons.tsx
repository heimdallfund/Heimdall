import type { SVGProps } from "react";

/** Thin line icon set (24px grid, 1.75 stroke) so every card uses the same visual language. */
const paths: Record<string, string> = {
  shield: "M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z",
  check: "m5 12.5 4.5 4.5L19 7.5",
  allow: "M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Zm-3.5 9 2.5 2.5 4.5-5",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  gauge: "M4 15a8 8 0 1 1 16 0M12 15l4-5M4 19h16",
  exit: "M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 16l-4-4 4-4M6 12h10",
  eye: "M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12Zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  lock: "M6.5 10.5V8a5.5 5.5 0 0 1 11 0v2.5M5 10.5h14v10H5zM12 14.5v2.5",
  bolt: "M13 2.5 5 13.5h6.5L10.5 21.5 19 10h-6.5L13 2.5Z",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6M9 16h3",
  chart: "M4 19h16M6 15l4-4 3 3 5-6",
  coins: "M8 8.5c3 0 5.5-1.1 5.5-2.5S11 3.5 8 3.5 2.5 4.6 2.5 6 5 8.5 8 8.5Zm-5.5-2.5v5c0 1.4 2.5 2.5 5.5 2.5M2.5 11v5c0 1.4 2.5 2.5 5.5 2.5m3-9c0-1.4 2.5-2.5 5.5-2.5s5.5 1.1 5.5 2.5S19 12 16 12s-5.5-1.1-5.5-2.5Zm0 0v8.5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V9.5",
  key: "M14.5 9.5a4.5 4.5 0 1 1-1.3-3.2M13.2 6.3 20 13v3h-3v2.5h-2.5L13 17",
  layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  code: "m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14",
  signal: "M5 18v-3M9.5 18v-6M14 18V9M18.5 18V5",
  vault: "M4 5h16v14H4zM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM12 8.5V6.5M7 19v1.5M17 19v1.5",
  alert: "M12 4 2.5 20h19L12 4Zm0 6v4.5m0 3h.01",
  status: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  x: "M4 4l16 16M20 4 4 20",
  sparkle: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18",
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={paths[name]} />
    </svg>
  );
}

export function IconTile({ name, tone = "brand" }: { name: IconName; tone?: "brand" | "allow" | "warn" | "deny" }) {
  const t = { brand: "border-ink text-brand", allow: "border-allow text-allow", warn: "border-warn text-warn", deny: "border-deny text-deny" }[tone];
  return <span className={`inline-flex size-10 shrink-0 items-center justify-center border bg-panel ${t}`}><Icon name={name} /></span>;
}
