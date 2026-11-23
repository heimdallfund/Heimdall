import { fetchVerdict, headline, label } from "@/lib/shield";
import { C, Card, Head, OG_SIZE, Stamp, ogImage } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall Shield verdict";

const COLOR = { DENY: C.deny, WARN: C.warn, ALLOW: C.allow } as const;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = /^0x[0-9a-fA-F]{64}$/.test(id) ? await fetchVerdict(id) : null;
  const verdict = v?.result.verdict ?? "ALLOW";
  const title = v ? headline(v.result) : "Checked by Heimdall Shield";
  const findings = (v?.result.findings ?? []).filter((f) => f.severity !== "info").slice(0, 3);
  return ogImage({
    eyebrow: "Shield verdict",
    title: [[{ t: `${verdict}.`, color: COLOR[verdict] }]],
    titleSize: 190,
    sub: title.length > 110 ? `${title.slice(0, title.lastIndexOf(" ", 107))}…` : title,
    path: `/v/${id.slice(0, 10)}…`,
    leftWidth: 560,
    visual: (
      <Card style={{ width: 470 }} shadow={COLOR[verdict]}>
        <Head bg={COLOR[verdict]} right="before signing">Simulated</Head>
        {findings.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "26px 24px", fontSize: 23 }}><Stamp v="ALLOW" size={18} />No risky findings</div>
        ) : (
          findings.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "20px 24px", fontSize: 21, borderBottom: i < findings.length - 1 ? `2px solid ${C.line}` : "none" }}>
              <Stamp v={f.severity === "deny" ? "DENY" : "WARN"} size={15} />
              <div style={{ display: "flex", flex: 1 }}>{label(f.code)}</div>
            </div>
          ))
        )}
      </Card>
    ),
  });
}
