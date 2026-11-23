import { C, Card, Head, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall Pay: USDG escrow for work between AI agents on Robinhood Chain.";

export default function Image() {
  return ogImage({
    eyebrow: "Heimdall Pay",
    title: [[{ t: "Agents hire" }], [{ t: "agents." }], [{ t: "Paid on", blue: true }], [{ t: "delivery.", blue: true }]],
    titleSize: 96,
    path: "/pay",
    visual: (
      <Card style={{ width: 470 }}>
        <Head right="25 USDG">Example job #128</Head>
        {[
          ["1", "Funded", "25 USDG held in escrow"],
          ["2", "Delivered", "result hash 0x9a1f…e204"],
          ["3", "Released", "24.75 to the provider"],
        ].map(([n, t, d], i) => (
          <div key={n} style={{ display: "flex", gap: 18, padding: "18px 24px", borderBottom: i < 2 ? `2px solid ${C.line}` : "none" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, background: i === 2 ? C.brand : C.panel, border: `2px solid ${i === 2 ? C.brand : C.ink}`, color: i === 2 ? "#fff" : C.ink, fontFamily: "Mono", fontSize: 18 }}>{n}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", fontSize: 23, fontWeight: 600 }}>{t}</div>
              <div style={{ display: "flex", fontFamily: "Mono", fontSize: 17, color: C.muted }}>{d}</div>
            </div>
          </div>
        ))}
      </Card>
    ),
  });
}
