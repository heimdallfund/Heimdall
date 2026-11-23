import { C, mono, ogImage, OG_SIZE } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall Signals: data your AI agent buys per call, paid in USDG with a gasless voucher.";

export default function Image() {
  return ogImage({
    eyebrow: "Signals",
    title: [[{ t: "Data" }, { t: "your" }], [{ t: "agent buys" }], [{ t: "per call.", blue: true }]],
    titleSize: 104,
    sub: "No subscriptions. 90% goes to the provider.",
    path: "/signals",
    visual: (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, width: 470 }}>
        {[
          ["Agent", "GET /v1/token-risk?token=0x9b1f…", false],
          ["Provider", "402 Payment Required · 0.02 USDG", true],
          ["Agent", "voucher signed offchain · no gas", false],
          ["Provider", "200 OK · { score: 12, level: \"low\" }", true],
        ].map(([who, what, right], i) => (
          <div key={i} style={{ display: "flex", justifyContent: right ? "flex-end" : "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "14px 18px", width: 380, background: right ? (i === 3 ? C.allowSoft : C.warnSoft) : C.panel, border: `3px solid ${C.ink}`, boxShadow: `7px 7px 0 ${C.ink}` }}>
              <div style={mono(14)}>{who as string}</div>
              <div style={{ display: "flex", fontFamily: "Mono", fontSize: 17 }}>{what as string}</div>
            </div>
          </div>
        ))}
      </div>
    ),
  });
}
