import { SHIELD_API_URL } from "@/lib/config";

/** Same-origin Shield health for the status pill: a down API never shows up as a browser console error. */
export async function GET() {
  try {
    const r = await fetch(`${SHIELD_API_URL}/health`, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    return Response.json({ ok: r.ok }, { headers: { "cache-control": "public, max-age=30" } });
  } catch {
    return Response.json({ ok: false }, { headers: { "cache-control": "public, max-age=30" } });
  }
}
