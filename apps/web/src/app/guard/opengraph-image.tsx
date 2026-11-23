import { C, Card, Head, Row, Stamp, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall Guard for Safe: your agent gets a wallet, you keep the keys.";

export default function Image() {
  return ogImage({
    eyebrow: "Guard for Safe",
    title: [[{ t: "Your agent" }], [{ t: "gets a wallet." }], [{ t: "You keep", blue: true }], [{ t: "the keys.", blue: true }]],
    titleSize: 90,
    path: "/guard",
    visual: (
      <Card style={{ width: 450 }}>
        <Head right="per 24 h">Agent limits</Head>
        <Row k="USDG" v="100 / day" />
        <Row k="ETH" v="0 / day" />
        <Row k="Shield receipt" v={<Stamp v="ALLOW" size={15} />} />
        <Row k="Add owners, modules" v="never" vColor={C.deny} />
        <Row k="Owners can pause" v="any time" vColor={C.allow} last />
      </Card>
    ),
  });
}
