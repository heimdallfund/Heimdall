import { cacheLife } from "next/cache";
import { SHIELD_API_URL } from "@/lib/config";

async function spec(): Promise<string | null> {
  "use cache";
  const body = await fetch(`${SHIELD_API_URL}/openapi.json`, { signal: AbortSignal.timeout(6_000) })
    .then((r) => (r.ok ? r.text() : null)).catch(() => null);
  if (body) cacheLife("hours"); else cacheLife("minutes"); // a miss is retried within minutes
  return body;
}

/** The Shield API's OpenAPI spec, also on the main domain where catalogs and agents look first. */
export async function GET() {
  const body = await spec();
  if (!body) return Response.json({ error: "spec_unavailable", spec: "https://api.heimdall.fund/openapi.json" }, { status: 502 });
  return new Response(body, { headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
