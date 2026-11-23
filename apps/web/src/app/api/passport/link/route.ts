import { SHIELD_API_URL } from "@/lib/config";

/** Link an ERC-8004 agentId to a wallet (Shield checks ownership onchain). */
export async function POST(req: Request) {
  try {
    const res = await fetch(`${SHIELD_API_URL}/v1/passport/link`, { method: "POST", headers: { "content-type": "application/json" }, body: await req.text(), signal: AbortSignal.timeout(10_000) });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "shield_unavailable" }, { status: 503 });
  }
}
