import { connection } from "next/server";
import { readHeimSupply } from "@/lib/heimSupply";

/** $HEIM supply for trackers (CoinGecko, CoinMarketCap, DexScreener) and anyone else. */
export async function GET() {
  await connection();
  const s = await readHeimSupply().catch(() => undefined);
  if (s === undefined) return Response.json({ error: "chain read failed" }, { status: 502 });
  if (s === null) return Response.json({ error: "$HEIM is not live yet" }, { status: 404 });
  return Response.json(s, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600", "access-control-allow-origin": "*" } });
}
