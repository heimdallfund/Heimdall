import { C, Card, Head, Row, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Guardian Points: earn points for making Robinhood Chain safer. Season 1.";

export default function Image() {
  return ogImage({
    eyebrow: "Guardian Points · Season 1",
    title: [[{ t: "Make the chain" }], [{ t: "safer." }], [{ t: "Get on the board.", blue: true }]],
    titleSize: 92,
    path: "/points",
    visual: (
      <Card style={{ width: 440 }}>
        <Head right="points">How to earn</Head>
        <Row k="Report a drainer" v="+200" vColor={C.brand} />
        <Row k="Invite a friend" v="+100" vColor={C.brand} />
        <Row k="Revoke a risky approval" v="+50" vColor={C.brand} />
        <Row k="First stake or Pay job" v="+25" vColor={C.brand} />
        <Row k="Hold in a vault" v="+1 / day" vColor={C.brand} last />
      </Card>
    ),
  });
}
