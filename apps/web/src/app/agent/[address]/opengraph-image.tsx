import { isAddress } from "viem";
import { fetchAgentStats } from "@/lib/shield";
import { C, Card, Head, OG_SIZE, Row, ogImage } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall agent profile";

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const s = isAddress(address) ? await fetchAgentStats(address) : null;
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  return ogImage({
    eyebrow: "Agent profile",
    title: [[{ t: short, raw: true }], [{ t: "Checked by", blue: true }], [{ t: "Heimdall.", blue: true }]],
    titleSize: 100,
    sub: "Every transaction it sends is simulated first.",
    path: `/agent/${short}`,
    visual: (
      <Card style={{ width: 440 }}>
        <Head right="live">Shield record</Head>
        <Row k="Shield checks" v={String(s?.checks ?? 0)} />
        <Row k="Unsafe stopped" v={String(s?.denied ?? 0)} vColor={C.deny} />
        <Row k="Allowed" v={s?.checks ? `${Math.round((s.allowed / s.checks) * 100)}%` : "—"} vColor={C.allow} last />
      </Card>
    ),
  });
}
