import { SHIELD_API_URL } from "@/lib/config";

/** Rug log from Shield (/v1/rugs): tokens checked while alive that later rugged, with the verdict from before. */
export async function GET(req: Request) {
  const limit = new URL(req.url).searchParams.get("limit") ?? "100";
  try {
    const res = await fetch(`${SHIELD_API_URL}/v1/rugs?limit=${encodeURIComponent(limit)}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json", "cache-control": "public, max-age=30" } });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
