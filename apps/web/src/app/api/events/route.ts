import { SHIELD_API_URL } from "@/lib/config";

/** Same-origin hop for anonymous analytics: no third-party request from the browser, and a down API never shows as an error. */
export async function POST(req: Request) {
  const body = (await req.text()).slice(0, 1024);
  await fetch(`${SHIELD_API_URL}/v1/events`, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(2_000) }).catch(() => {});
  return new Response(null, { status: 204 });
}
