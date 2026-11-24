import { SHIELD_API_URL } from "@/lib/config";
import { relayHeaders } from "@/lib/relay";

/** Wallet Check proxy: keeps the Shield API key server-side and forwards the visitor IP for per-visitor limits. */
export async function GET(req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return Response.json({ error: "invalid_address" }, { status: 400 });
  const refresh = new URL(req.url).searchParams.get("refresh") === "1" ? "?refresh=1" : "";
  try {
    const res = await fetch(`${SHIELD_API_URL}/v1/wallet/${address}${refresh}`, {
      headers: relayHeaders(req.headers),
      signal: AbortSignal.timeout(55_000), cache: "no-store",
    });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "shield_unavailable", message: "Wallet Check goes live with the mainnet launch." }, { status: 503 });
  }
}
