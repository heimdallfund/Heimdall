import { SHIELD_API_URL } from "@/lib/config";

/** Claims the first-use bonus for a stake or a Pay job (Shield checks the transaction). */
export async function POST(req: Request) {
  try {
    const res = await fetch(`${SHIELD_API_URL}/v1/points/action`, { method: "POST", headers: { "content-type": "application/json" }, body: await req.text(), signal: AbortSignal.timeout(20_000) });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "shield_unavailable" }, { status: 503 });
  }
}
