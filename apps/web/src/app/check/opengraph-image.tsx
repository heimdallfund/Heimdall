import { C, Card, Head, Row, Stamp, mono, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Wallet Check: who can still move your tokens? Every risky approval on Robinhood Chain, one-click revoke.";

export default function Image() {
  return ogImage({
    eyebrow: "Wallet Check · free",
    title: [[{ t: "Who can still" }], [{ t: "move your" }], [{ t: "tokens?", blue: true }]],
    titleSize: 96,
    sub: "Every risky approval on Robinhood Chain, ranked by the dollars it exposes. Read-only.",
    path: "/check",
    visual: (
      <Card style={{ width: 460 }}>
        <Head right="example">Wallet check</Head>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "18px 24px 10px" }}>
          <div style={mono(16)}>Safety score</div>
          <div style={{ display: "flex", fontFamily: "Display", fontSize: 92, lineHeight: 0.9, color: C.deny }}>57</div>
        </div>
        <Row k={<><Stamp v="DENY" size={15} /><b>USDG</b></>} v="unlimited" vColor={C.deny} />
        <Row k={<><Stamp v="WARN" size={15} /><b>NVDA</b></>} v="unlimited" vColor={C.warn} />
        <Row k={<><Stamp v="ALLOW" size={15} /><b>USDG</b></>} v="100" />
        <Row k={<span style={{ color: C.muted }}>Value at risk</span>} v="$2,500" vColor={C.deny} last />
      </Card>
    ),
  });
}
