import { isAddress } from "viem";
import { C, Card, Head, OG_SIZE, Row, ogImage } from "@/lib/og";
import { fetchTokenCheck, legState, legText, VERDICT_HEAD } from "@/lib/tokencheck";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Heimdall Token Check: simulated buy, sell and transfer of a Robinhood Chain token";

const COLOR = { DENY: C.deny, WARN: C.warn, ALLOW: C.allow } as const;
const LEG = { ok: C.allow, warn: C.warn, bad: C.deny, skip: C.muted } as const;

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const r = isAddress(address) ? (await fetchTokenCheck(address, 8_000)).report : null;
  const path = `/token-check/${address.slice(0, 8)}…`;
  if (!r) {
    return ogImage({ eyebrow: "Token Check", title: [[{ t: "Can you" }], [{ t: "sell it?", blue: true }]], titleSize: 110, sub: "A simulated buy, sell and transfer of any Robinhood Chain token, before you buy.", path });
  }
  const sym = (r.symbol ?? "Token").slice(0, 12);
  const top = r.findings.find((f) => f.severity === "deny") ?? r.findings.find((f) => f.severity === "warn");
  const sub = top?.message ?? "Buying, selling and moving it worked in the simulation, without a tax or a clawback.";
  const clawed = r.pullableBy.length > 0;
  return ogImage({
    eyebrow: "Token Check",
    title: [[{ t: sym, raw: true }], [{ t: `${VERDICT_HEAD[r.verdict]}.`, color: COLOR[r.verdict] }]],
    titleSize: sym.length > 8 ? 78 : 104,
    sub: sub.length > 120 ? `${sub.slice(0, sub.lastIndexOf(" ", 117))}…` : sub,
    path,
    leftWidth: 580,
    visual: (
      <Card style={{ width: 440 }} shadow={COLOR[r.verdict]}>
        <Head bg={COLOR[r.verdict]} right={r.verdict}>Simulated</Head>
        <Row k="Buy" v={legText(r.buy)} vColor={LEG[legState(r.buy)]} />
        <Row k="Sell" v={legText(r.sell)} vColor={LEG[legState(r.sell)]} />
        <Row k="Transfer" v={legText(r.transfer)} vColor={LEG[legState(r.transfer)]} />
        <Row k="Clawback" v={r.buy ? (clawed ? "Possible" : "None found") : "Not simulated"} vColor={r.buy ? (clawed ? C.deny : C.allow) : C.muted} last />
      </Card>
    ),
  });
}
