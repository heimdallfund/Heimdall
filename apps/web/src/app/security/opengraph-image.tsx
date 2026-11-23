import { C, Card, mono, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall security: limits enforced by contracts, three internal reviews, 112 contract tests.";

export default function Image() {
  return ogImage({
    eyebrow: "Security",
    title: [[{ t: "Enforced by" }], [{ t: "contracts," }], [{ t: "not promises.", blue: true }]],
    titleSize: 94,
    sub: "Every limit lives onchain. Every review and test is public.",
    path: "/security",
    visual: (
      <Card style={{ width: 440, flexDirection: "row", flexWrap: "wrap" }}>
        {[["3", "internal reviews"], ["112", "contract tests"], ["25", "fuzz & invariant properties"], ["0", "open critical or high"]].map(([n, l], i) => (
          <div key={l} style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 217, height: 190, padding: "22px 24px", borderRight: i % 2 === 0 ? `2px solid ${C.line}` : "none", borderBottom: i < 2 ? `2px solid ${C.line}` : "none" }}>
            <div style={{ display: "flex", fontFamily: "Display", fontSize: 88, lineHeight: 0.9, color: i === 3 ? C.allow : C.ink }}>{n}</div>
            <div style={mono(15)}>{l}</div>
          </div>
        ))}
      </Card>
    ),
  });
}
