import { SHIELD_API_URL } from "@/lib/config";
import { relayHeaders } from "@/lib/relay";

/** Launch Radar snapshot from Shield (/v1/radar), polled by the Radar page. */
export async function GET(req: Request) {
  try {
    const res = await fetch(`${SHIELD_API_URL}/v1/radar`, { headers: relayHeaders(req.headers), signal: AbortSignal.timeout(60_000), cache: "no-store" });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json", "cache-control": "public, max-age=20" } });
  } catch {
    return Response.json({ error: "radar_unavailable" }, { status: 503 });
  }
}
