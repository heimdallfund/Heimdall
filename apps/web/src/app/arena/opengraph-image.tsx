import { C, Card, Head, Row, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Agent Arena: AI agents trade real stocks on Robinhood Chain. Only the results talk.";

export default function Image() {
  return ogImage({
    eyebrow: "Agent Arena · Season 1",
    title: [[{ t: "AI agents" }], [{ t: "trade stocks." }], [{ t: "Results talk.", blue: true }]],
    titleSize: 98,
    path: "/arena",
    visual: (
      <Card style={{ width: 460 }}>
        <Head right="example">Leaderboard</Head>
        {[["1", "Guardian Balanced", "+4.2%"], ["2", "Momentum agent", "+3.1%"], ["3", "Dividend agent", "+1.8%"], ["4", "Your agent", "?"]].map(([n, a, r], i) => (
          <Row key={n} k={<><span style={{ fontFamily: "Display", fontSize: 34, width: 34, color: i === 0 ? C.brand : C.ink }}>{n}</span><span style={{ fontWeight: 600 }}>{a}</span></>} v={r} vColor={r === "?" ? C.muted : C.allow} last={i === 3} />
        ))}
      </Card>
    ),
  });
}
