import { C, Card, Head, Row, mono, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall Agent Passport: a trust score every agent can check, on ERC-8004.";

export default function Image() {
  return ogImage({
    eyebrow: "Agent Passport · ERC-8004",
    title: [[{ t: "A trust score" }], [{ t: "every agent" }], [{ t: "can check.", blue: true }]],
    titleSize: 100,
    sub: "From Shield, Pay and the risk list. Onchain.",
    path: "/passport",
    visual: (
      <Card style={{ width: 440 }}>
        <Head right="example">Agent #42</Head>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "20px 24px 8px" }}>
          <div style={mono(16)}>Heimdall Score</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <div style={{ display: "flex", fontFamily: "Display", fontSize: 100, lineHeight: 0.85, color: C.allow }}>91</div>
            <div style={{ ...mono(16, C.allow), padding: "4px 8px", border: `2px solid ${C.allow}` }}>Tier A</div>
          </div>
        </div>
        <Row k="Shield record" v="97" />
        <Row k="Heimdall Pay" v="88" />
        <Row k="History" v="84" last />
      </Card>
    ),
  });
}
