import { SHIELD_API_URL } from "@/lib/config";

/** Accuracy scorecard from Shield (/v1/bench). */
export async function GET() {
  try {
    const res = await fetch(`${SHIELD_API_URL}/v1/bench`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
