import { C, Card, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall docs: protect an AI agent on Robinhood Chain in two minutes with the SDK, MCP server or plain HTTP.";

export default function Image() {
  return ogImage({
    eyebrow: "Docs",
    title: [[{ t: "Protect an" }], [{ t: "agent in" }], [{ t: "two minutes.", blue: true }]],
    titleSize: 100,
    sub: "TypeScript SDK, MCP server or plain HTTP.",
    path: "/docs",
    visual: (
      <Card style={{ width: 490, background: C.ink }} shadow={C.brand}>
        <div style={{ display: "flex", gap: 8, padding: "14px 20px", borderBottom: "2px solid #2A2E37" }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <div key={c} style={{ display: "flex", width: 12, height: 12, borderRadius: 6, background: c }} />)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "20px 24px 26px", fontFamily: "Mono", fontSize: 18, color: "#E7E9EE" }}>
          <div style={{ display: "flex", color: "#8B93A5" }}>$ npm i @heimdall/sdk viem</div>
          <div style={{ display: "flex", height: 8 }} />
          <div style={{ display: "flex" }}><span style={{ color: "#9FB0FF" }}>const</span>&nbsp;shield = new HeimdallShield()</div>
          <div style={{ display: "flex" }}><span style={{ color: "#9FB0FF" }}>await</span>&nbsp;guardedSend(wallet, tx, {"{ shield }"})</div>
          <div style={{ display: "flex", height: 8 }} />
          <div style={{ display: "flex", color: "#8B93A5" }}>{"// DENY → never signed"}</div>
          <div style={{ display: "flex", color: "#7EE2A8" }}>{"// ALLOW → sent with a receipt"}</div>
        </div>
      </Card>
    ),
  });
}
