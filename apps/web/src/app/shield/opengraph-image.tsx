import { C, Card, Head, Stamp, mono, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall Shield: a firewall between your AI agent and its signature. Simulated on Robinhood Chain before signing.";

export default function Image() {
  return ogImage({
    eyebrow: "Shield API",
    title: [[{ t: "A firewall" }], [{ t: "for every" }], [{ t: "signature.", blue: true }]],
    titleSize: 100,
    sub: "Simulated on the latest block, judged in plain words, signed only if safe.",
    path: "/shield",
    visual: (
      <Card style={{ width: 470 }}>
        <Head right="184 ms">POST /v1/check</Head>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 24px 8px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={mono(15)}>Risk score</div>
            <div style={{ display: "flex", fontFamily: "Display", fontSize: 72, lineHeight: 0.9, color: C.deny }}>96</div>
          </div>
          <Stamp v="DENY" size={30} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "14px 24px 22px", fontSize: 20 }}>
          <div style={{ display: "flex", gap: 10 }}><div style={{ display: "flex", width: 10, height: 10, marginTop: 9, flexShrink: 0, background: C.deny }} />Unlimited USDG approval to a wallet with no code</div>
          <div style={{ display: "flex", gap: 10 }}><div style={{ display: "flex", width: 10, height: 10, marginTop: 9, flexShrink: 0, background: C.deny }} />Moves 100% of the agent&apos;s USDG</div>
        </div>
        <div style={{ ...mono(14), padding: "12px 24px", borderTop: `2px solid ${C.line}` }}>EIP-712 receipt · expires in 120 s</div>
      </Card>
    ),
  });
}
