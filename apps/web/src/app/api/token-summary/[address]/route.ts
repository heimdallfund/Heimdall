import { isAddress } from "viem";
import { SHIELD_API_URL } from "@/lib/config";
import { relayHeaders } from "@/lib/relay";

/** AI summary of a Token Check (Shield's /v1/token/:address/summary), fetched by the report after it renders. */
export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) return Response.json({ error: "invalid_address" }, { status: 400 });
  try {
    const res = await fetch(`${SHIELD_API_URL}/v1/token/${address}/summary`, { headers: relayHeaders(req.headers), signal: AbortSignal.timeout(25_000) });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ summary: null }, { status: 503 });
  }
}
