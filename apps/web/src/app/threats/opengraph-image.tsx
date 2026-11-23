import { C, Card, Head, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall Threat Board: what Shield is catching on Robinhood Chain, live.";

export default function Image() {
  return ogImage({
    eyebrow: "Threat Board · live",
    title: [[{ t: "What Shield" }], [{ t: "is catching" }], [{ t: "right now.", blue: true }]],
    titleSize: 98,
    sub: "Aggregate data from real checks. Nothing self-reported.",
    path: "/threats",
    visual: (
      <Card style={{ width: 470 }} shadow={C.deny}>
        <Head bg={C.deny} right="pattern">Most caught</Head>
        {[["Unlimited approval to a wallet", 92], ["Permit signed to a wallet", 74], ["Honeypot token", 55], ["Moves 90%+ of a balance", 41], ["Blind hash signature", 28]].map(([t, w], i) => (
          <div key={t as string} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 24px", borderBottom: i < 4 ? `2px solid ${C.line}` : "none" }}>
            <div style={{ display: "flex", fontSize: 19 }}>{t}</div>
            <div style={{ display: "flex", height: 8, background: C.line }}><div style={{ display: "flex", width: `${w}%`, background: C.deny }} /></div>
          </div>
        ))}
      </Card>
    ),
  });
}
