import { C, Card, Head, Row, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "$HEIM: hold it for cheaper protection, stake it to earn USDG from Heimdall protocol fees.";

export default function Image() {
  return ogImage({
    eyebrow: "$HEIM",
    title: [[{ t: "Hold it." }], [{ t: "Stake it." }], [{ t: "Earn USDG.", blue: true }]],
    titleSize: 100,
    sub: "Real yield from protocol fees. No emissions.",
    path: "/token",
    visual: (
      <Card style={{ width: 470 }}>
        <Head right="without · holder">Benefits</Head>
        <Row k="Free checks / day" v={<span style={{ display: "flex", gap: 14 }}><span style={{ color: C.muted }}>1,000</span><span style={{ color: C.brand }}>5,000</span></span>} />
        <Row k="Signals split" v={<span style={{ display: "flex", gap: 14 }}><span style={{ color: C.muted }}>90%</span><span style={{ color: C.brand }}>95%</span></span>} />
        <Row k="Vault fee" v={<span style={{ display: "flex", gap: 14 }}><span style={{ color: C.muted }}>15%</span><span style={{ color: C.brand }}>12.5%</span></span>} />
        <Row k="Protocol fees" v={<span style={{ color: C.brand }}>stake to earn</span>} last />
      </Card>
    ),
  });
}
