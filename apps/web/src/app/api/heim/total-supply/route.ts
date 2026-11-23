import { connection } from "next/server";
import { readHeimSupply } from "@/lib/heimSupply";

/** Total $HEIM supply as a plain number, the format trackers ask for. */
export async function GET() {
  await connection();
  const s = await readHeimSupply().catch(() => undefined);
  if (!s) return new Response(s === null ? "not live" : "chain read failed", { status: s === null ? 404 : 502 });
  return new Response(s.total, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, s-maxage=300, stale-while-revalidate=600", "access-control-allow-origin": "*" } });
}
