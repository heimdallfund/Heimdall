import { C, Card, Head, OG_SIZE, Row, ogImage } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Token Check: can you sell it after you buy it? A simulated buy, sell and transfer of any Robinhood Chain token.";

export default function Image() {
  return ogImage({
    eyebrow: "Token Check · free",
    title: [[{ t: "Can you" }], [{ t: "sell it after" }], [{ t: "you buy it?", blue: true }]],
    titleSize: 82,
    sub: "Honeypots, hidden taxes, clawbacks and fake tickers, checked before you buy.",
    path: "/token-check",
    visual: (
      <Card style={{ width: 440 }} shadow={C.deny}>
        <Head bg={C.deny} right="DENY">Simulated</Head>
        <Row k="Buy" v="Works, no tax" vColor={C.allow} />
        <Row k="Sell" v="Fails" vColor={C.deny} />
        <Row k="Transfer" v="Works, no tax" vColor={C.allow} />
        <Row k="Clawback" v="Possible" vColor={C.deny} last />
      </Card>
    ),
  });
}
