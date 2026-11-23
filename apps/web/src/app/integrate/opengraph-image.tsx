import { C, Card, Head, Row, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Integrate Heimdall: Risk Oracle, Guard for Safe, x402 payments and Agent Passports on Robinhood Chain.";

export default function Image() {
  return ogImage({
    eyebrow: "Integrate",
    title: [[{ t: "Safety your" }], [{ t: "app can" }], [{ t: "plug into.", blue: true }]],
    titleSize: 104,
    sub: "Four pieces, each works on its own.",
    path: "/integrate",
    visual: (
      <Card style={{ width: 460 }}>
        <Head right="one call each">Build on Heimdall</Head>
        <Row k="Risk Oracle" v="isBlocked(to)" vColor={C.brand} />
        <Row k="Guard for Safe" v="enableModule()" vColor={C.brand} />
        <Row k="x402 in USDG" v="402 → pay → 200" vColor={C.brand} />
        <Row k="Agent Passport" v="getSummary(id)" vColor={C.brand} last />
      </Card>
    ),
  });
}
