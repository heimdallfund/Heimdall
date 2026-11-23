import { ImageResponse } from "next/og";
import { fetchVerdict, headline, label } from "@/lib/shield";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Heimdall Shield verdict";

const C = { DENY: ["#B42318", "#FDE8E9"], WARN: ["#8A5A00", "#FFF4DB"], ALLOW: ["#0B7A3B", "#E6F6EC"] } as const;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = /^0x[0-9a-fA-F]{64}$/.test(id) ? await fetchVerdict(id) : null;
  const verdict = v?.result.verdict ?? "ALLOW";
  const [fg, bg] = C[verdict];
  const title = v ? headline(v.result) : "Checked by Heimdall Shield";
  const codes = (v?.result.findings ?? []).filter((f) => f.severity !== "info").slice(0, 2).map((f) => label(f.code));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: `linear-gradient(180deg, ${bg} 0%, #FFFFFF 60%)`, fontFamily: "sans-serif", color: "#1B2233" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>Heimdall Shield</div>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 800, color: fg, background: bg, padding: "10px 34px", borderRadius: 20, border: `3px solid ${fg}33` }}>{verdict}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 54, fontWeight: 800, lineHeight: 1.1, maxWidth: 1000 }}>{title.length > 96 ? `${title.slice(0, title.lastIndexOf(" ", 93))}…` : title}</div>
          {codes.map((c) => <div key={c} style={{ display: "flex", fontSize: 28, color: "#525B6E" }}>• {c}</div>)}
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#525B6E" }}>Simulated on Robinhood Chain before signing · heimdall</div>
      </div>
    ),
    size,
  );
}
