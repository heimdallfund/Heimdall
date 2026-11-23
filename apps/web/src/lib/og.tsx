import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { CSSProperties, ReactNode } from "react";

/** Shared look for every Open Graph / X card: warm paper, condensed display type, mono labels, hard ink shadows. */

export const OG_SIZE = { width: 1200, height: 630 };

export const C = {
  paper: "#F6F4EE",
  panel: "#FFFFFF",
  ink: "#14161B",
  muted: "#5B606B",
  line: "#E3DED2",
  brand: "#3355FF",
  brandSoft: "#E8EDFF",
  allow: "#0B7A3B",
  allowSoft: "#E6F4EB",
  warn: "#8A5A00",
  warnSoft: "#FFF2D6",
  deny: "#C0261B",
  denySoft: "#FCE7E5",
};

const MARK = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><polygon points="32,4 9,12 32,30" fill="#7C95FF"/><polygon points="32,4 55,12 32,30" fill="#3355FF"/><polygon points="9,12 9,30 32,30" fill="#5C78FF"/><polygon points="55,12 55,30 32,30" fill="#1F3FE0"/><polygon points="9,30 32,60 32,30" fill="#4A68FF"/><polygon points="55,30 32,60 32,30" fill="#2A49F0"/></svg>',
).toString("base64")}`;

let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 600 | 700 | 800; style: "normal" }[]> | null = null;
function loadFonts() {
  const dir = join(process.cwd(), "src/lib/og-fonts");
  fonts ??= Promise.all([
    readFile(join(dir, "archivo-condensed-800.ttf")).then((data) => ({ name: "Display", data, weight: 800 as const, style: "normal" as const })),
    readFile(join(dir, "jetbrains-mono-700.ttf")).then((data) => ({ name: "Mono", data, weight: 700 as const, style: "normal" as const })),
    readFile(join(dir, "inter-400.ttf")).then((data) => ({ name: "Inter", data, weight: 400 as const, style: "normal" as const })),
    readFile(join(dir, "inter-600.ttf")).then((data) => ({ name: "Inter", data, weight: 600 as const, style: "normal" as const })),
  ]);
  return fonts;
}

/** One segment of a headline; `blue` paints it in the brand colour, `color` in any colour, `raw` keeps its case. */
export type Seg = { t: string; blue?: boolean; color?: string; raw?: boolean };

export const mono = (size: number, color: string = C.muted, extra: CSSProperties = {}): CSSProperties => ({
  display: "flex", fontFamily: "Mono", fontWeight: 700, fontSize: size, letterSpacing: size * 0.1, textTransform: "uppercase", color, ...extra,
});

/** A bordered card with the signature hard shadow. */
export function Card({ children, style = {}, shadow = C.ink }: { children: ReactNode; style?: CSSProperties; shadow?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", background: C.panel, border: `3px solid ${C.ink}`, boxShadow: `12px 12px 0 ${shadow}`, ...style }}>
      {children}
    </div>
  );
}

/** Verdict stamp: ALLOW, WARN or DENY. */
export function Stamp({ v, size = 22 }: { v: "ALLOW" | "WARN" | "DENY"; size?: number }) {
  const [fg, bg] = v === "DENY" ? [C.deny, C.denySoft] : v === "WARN" ? [C.warn, C.warnSoft] : [C.allow, C.allowSoft];
  return (
    <div style={{ ...mono(size, fg), alignItems: "center", gap: size * 0.4, padding: `${size * 0.25}px ${size * 0.55}px`, background: bg, border: `2px solid ${fg}` }}>
      <div style={{ display: "flex", width: size * 0.45, height: size * 0.45, background: fg }} />
      {v}
    </div>
  );
}

/**
 * The common frame. `title` is set in the condensed display face; `visual` sits on the right.
 * `titleSize` shrinks long headlines so they stay inside the left column.
 */
export async function ogImage({ eyebrow, title, sub, path, visual, titleSize = 92, leftWidth = 590 }: {
  eyebrow: string;
  title: Seg[][];
  sub?: string;
  path: string;
  visual?: ReactNode;
  titleSize?: number;
  leftWidth?: number;
}) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: C.paper, fontFamily: "Inter", color: C.ink }}>
        {/* paper grid */}
        <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: `linear-gradient(${C.line} 1px, transparent 1px), linear-gradient(90deg, ${C.line} 1px, transparent 1px)`, backgroundSize: "48px 48px", opacity: 0.7 }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", backgroundImage: `radial-gradient(70% 80% at 30% 45%, ${C.paper} 35%, rgba(246,244,238,0) 100%)` }} />
        {/* top bar */}
        <div style={{ position: "absolute", top: 52, left: 64, right: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img src={MARK} width={46} height={46} alt="" />
            <div style={{ display: "flex", fontSize: 32, fontWeight: 600, letterSpacing: -0.5 }}>Heimdall</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", width: 26, height: 3, background: C.brand }} />
            <div style={mono(18, C.brand)}>{`heimdall.fund${path}`}</div>
          </div>
        </div>
        {/* left column */}
        <div style={{ position: "absolute", left: 64, top: 140, width: leftWidth, display: "flex", flexDirection: "column" }}>
          <div style={{ ...mono(19, C.ink), alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", width: 12, height: 12, background: C.brand }} />
            {eyebrow}
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 22, fontFamily: "Display", fontWeight: 800, fontSize: titleSize, lineHeight: 0.9, textTransform: "uppercase" }}>
            {title.map((line, i) => (
              <div key={i} style={{ display: "flex", gap: titleSize * 0.22 }}>
                {line.map((s, j) => <span key={j} style={{ color: s.color ?? (s.blue ? C.brand : C.ink), textTransform: s.raw ? "none" : "uppercase" }}>{s.t}</span>)}
              </div>
            ))}
          </div>
          {sub && <div style={{ display: "flex", marginTop: 26, fontSize: 25, lineHeight: 1.4, color: C.muted, maxWidth: leftWidth - 20 }}>{sub}</div>}
        </div>
        {/* footer */}
        <div style={{ position: "absolute", left: 64, bottom: 46, display: "flex", ...mono(15, C.muted) }}>Robinhood Chain · 4663</div>
        {visual && <div style={{ position: "absolute", right: 64, top: 0, bottom: 0, display: "flex", alignItems: "center" }}>{visual}</div>}
      </div>
    ),
    { ...OG_SIZE, fonts: await loadFonts() },
  );
}

/** A row inside a card: label left, value right. */
export function Row({ k, v, last, vColor = C.ink, kStyle = {} }: { k: ReactNode; v: ReactNode; last?: boolean; vColor?: string; kStyle?: CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, padding: "15px 24px", borderBottom: last ? "none" : `2px solid ${C.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 21, ...kStyle }}>{k}</div>
      <div style={{ display: "flex", fontFamily: "Mono", fontWeight: 700, fontSize: 20, color: vColor }}>{v}</div>
    </div>
  );
}

/** Card header strip: mono label on ink. */
export function Head({ children, right, bg = C.ink }: { children: ReactNode; right?: ReactNode; bg?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 24px", background: bg }}>
      <div style={mono(16, "#FFFFFF")}>{children}</div>
      {right && <div style={mono(16, "#FFFFFF", { opacity: 0.75 })}>{right}</div>}
    </div>
  );
}
