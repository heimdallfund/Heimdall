import { C, Card, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall Risk Oracle: onchain risk data any contract reads in one call. Free.";

export default function Image() {
  return ogImage({
    eyebrow: "Risk Oracle · free",
    title: [[{ t: "Drainers" }], [{ t: "stay out." }], [{ t: "One call.", blue: true }]],
    titleSize: 104,
    sub: "Drainers, phishing and honeypots, onchain.",
    path: "/oracle",
    visual: (
      <Card style={{ width: 470, background: C.ink }} shadow={C.brand}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "24px 26px", fontFamily: "Mono", fontSize: 20, color: "#E7E9EE" }}>
          <div style={{ display: "flex", color: "#8B93A5" }}>{"// in your contract"}</div>
          <div style={{ display: "flex" }}><span style={{ color: "#9FB0FF" }}>if</span>&nbsp;(heimdall.isBlocked(to))</div>
          <div style={{ display: "flex", paddingLeft: 28 }}><span style={{ color: "#FF8A80" }}>revert</span>&nbsp;Blocked(to);</div>
          <div style={{ display: "flex", height: 6 }} />
          <div style={{ display: "flex", color: "#8B93A5" }}>{"// riskOf(0xBAD…)"}</div>
          <div style={{ display: "flex", color: "#FF8A80" }}>level 3 · drainer, community</div>
        </div>
      </Card>
    ),
  });
}
