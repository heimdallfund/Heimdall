import { C, Card, Head, Row, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall Auto-Invest: buy tokenized stocks on a schedule from your own wallet, never worse than your price bound.";

export default function Image() {
  return ogImage({
    eyebrow: "Auto-Invest",
    title: [[{ t: "Buy stocks" }], [{ t: "on autopilot." }], [{ t: "Never at a", blue: true }], [{ t: "bad price.", blue: true }]],
    titleSize: 92,
    path: "/invest",
    visual: (
      <Card style={{ width: 450 }}>
        <Head right="weekly">Example plan</Head>
        <Row k="Stock" v="NVDA" />
        <Row k="Each buy" v="50 USDG" />
        <Row k="Buys done" v="12 of 52" />
        <Row k="Price bound" v="1% vs Chainlink" vColor={C.brand} />
        <Row k="Lands in" v="your wallet" last />
      </Card>
    ),
  });
}
