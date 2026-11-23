import { C, mono, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "x402 on Heimdall: pay per call in USDG, no API key. A facilitator that checks every recipient first.";

export default function Image() {
  return ogImage({
    eyebrow: "x402 · USDG",
    title: [[{ t: "Pay per call." }], [{ t: "No API key.", blue: true }]],
    titleSize: 104,
    sub: "The payment is the login. Gasless for the agent.",
    path: "/x402",
    visual: (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, width: 450 }}>
        {[
          ["402 Payment Required", "0.001 USDG · eip155:4663", C.warnSoft],
          ["PAYMENT-SIGNATURE", "EIP-3009 · signed, no gas", C.panel],
          ["Recipient checked", "not on Heimdall's blocklist", C.panel],
          ["200 OK", "settled onchain · served", C.allowSoft],
        ].map(([a, b, bg], i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "14px 18px", background: bg, border: `3px solid ${C.ink}`, boxShadow: `7px 7px 0 ${C.ink}`, marginLeft: i % 2 ? 40 : 0 }}>
            <div style={{ display: "flex", fontFamily: "Mono", fontSize: 19 }}>{a}</div>
            <div style={mono(14)}>{b}</div>
          </div>
        ))}
      </div>
    ),
  });
}
