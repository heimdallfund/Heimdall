import { SHIELD_API_URL } from "@/lib/config";

/** Same-origin feed for the live status page: Shield's /v1/status plus how long Shield took to answer from here. */
export async function GET() {
  const t = Date.now();
  try {
    const r = await fetch(`${SHIELD_API_URL}/v1/status`, { signal: AbortSignal.timeout(6_000), cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const body = (await r.json()) as Record<string, unknown>;
    return Response.json({ ...body, shieldMs: Date.now() - t }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ unreachable: true, checkedAt: Date.now() }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
