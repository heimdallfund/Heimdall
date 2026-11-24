import { SHIELD_API_URL } from "@/lib/config";
import { relayHeaders } from "@/lib/relay";

/** Proxies the console to the Shield API so the browser never needs the API key. */
export async function POST(req: Request) {
  const body = await req.text();
  try {
    const res = await fetch(`${SHIELD_API_URL}/v1/check`, {
      method: "POST",
      // Forward the visitor's IP so Shield's free-tier limits apply per visitor, not to the website as a whole.
      headers: relayHeaders(req.headers, { "content-type": "application/json" }),
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const headers = new Headers({ "content-type": "application/json" });
    for (const h of ["x-ratelimit-remaining", "x-heimdall-quota-remaining", "retry-after"]) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(await res.text(), { status: res.status, headers });
  } catch {
    return Response.json({ error: "shield_unavailable", message: "Shield API is not reachable. Treat the transaction as unsafe." }, { status: 503 });
  }
}
