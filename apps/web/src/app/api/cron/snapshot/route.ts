import { snapshotAll } from "@/lib/history";

/** Vercel Cron (every 15 minutes, see vercel.json). Protected by CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  const result = await snapshotAll();
  return Response.json({ ok: true, vaults: result.length, result });
}
