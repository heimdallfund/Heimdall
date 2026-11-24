import { isAddress } from "viem";
import { SHIELD_API_URL } from "@/lib/config";
import { relayHeaders } from "@/lib/relay";

/** Risk lookup for the Risk Oracle page (Shield's /v1/risk/:address, free). */
export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) return Response.json({ error: "invalid_address" }, { status: 400 });
  try {
    const res = await fetch(`${SHIELD_API_URL}/v1/risk/${address}`, { headers: relayHeaders(req.headers), signal: AbortSignal.timeout(8000) });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "shield_unavailable", message: "Shield API is not reachable right now." }, { status: 503 });
  }
}
