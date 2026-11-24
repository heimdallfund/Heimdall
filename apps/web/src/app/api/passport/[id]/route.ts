import { SHIELD_API_URL } from "@/lib/config";
import { relayHeaders } from "@/lib/relay";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^(0x[0-9a-fA-F]{40}|\d{1,30})$/.test(id)) return Response.json({ error: "invalid_id" }, { status: 400 });
  try {
    const res = await fetch(`${SHIELD_API_URL}/v1/passport/${id}`, { headers: relayHeaders(req.headers), signal: AbortSignal.timeout(10_000) });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "shield_unavailable" }, { status: 503 });
  }
}
