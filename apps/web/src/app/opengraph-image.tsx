import { Card, Head, Row, Stamp, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall: nothing gets signed unchecked. The guardian layer for AI agents on Robinhood Chain.";

export default function Image() {
  return ogImage({
    eyebrow: "Agent firewall",
    title: [[{ t: "Nothing gets" }], [{ t: "signed" }], [{ t: "unchecked.", blue: true }]],
    titleSize: 100,
    sub: "The guardian layer for AI agents that move money on Robinhood Chain.",
    path: "",
    visual: (
      <Card style={{ width: 470 }}>
        <Head right="before signing">Shield checks</Head>
        <Row k={<span style={{ fontFamily: "Mono", fontSize: 19 }}>approve USDG · unlimited</span>} v={<Stamp v="DENY" size={17} />} />
        <Row k={<span style={{ fontFamily: "Mono", fontSize: 19 }}>swap 50 USDG → NVDA</span>} v={<Stamp v="ALLOW" size={17} />} />
        <Row k={<span style={{ fontFamily: "Mono", fontSize: 19 }}>Permit2 · 30-day expiry</span>} v={<Stamp v="WARN" size={17} />} />
        <Row k={<span style={{ fontFamily: "Mono", fontSize: 19 }}>pay job #128 · 25 USDG</span>} v={<Stamp v="ALLOW" size={17} />} last />
      </Card>
    ),
  });
}
