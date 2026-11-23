import { C, Card, Head, Row, mono, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall vaults: stock vaults run by AI agents, every trade checked by Shield, every limit enforced onchain.";

export default function Image() {
  return ogImage({
    eyebrow: "Stock vaults",
    title: [[{ t: "Agents trade." }], [{ t: "Limits hold" }], [{ t: "onchain.", blue: true }]],
    titleSize: 98,
    sub: "Deposit USDG. You can always exit in kind.",
    path: "/vaults",
    visual: (
      <Card style={{ width: 460 }}>
        <Head right="example">Guardian Balanced</Head>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "20px 24px 6px" }}>
          <div style={{ display: "flex", fontFamily: "Display", fontSize: 72, lineHeight: 0.9 }}>1.0482</div>
          <div style={mono(16)}>USDG / share</div>
        </div>
        <div style={{ display: "flex", margin: "12px 24px 6px", height: 14 }}>
          <div style={{ display: "flex", width: "30%", background: "#2F9E5B" }} />
          <div style={{ display: "flex", width: "30%", background: C.deny }} />
          <div style={{ display: "flex", width: "40%", background: C.brand }} />
        </div>
        <div style={{ display: "flex", gap: 18, padding: "4px 24px 14px", fontFamily: "Mono", fontSize: 15, color: C.muted }}><span>NVDA 30%</span><span>TSLA 30%</span><span>USDG 40%</span></div>
        <Row k="Per trade" v="max 25% of NAV" />
        <Row k="Loss per trade" v="max 3%" />
        <Row k="Loss per day" v="max 5%" last />
      </Card>
    ),
  });
}
