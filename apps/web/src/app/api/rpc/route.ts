import { chain } from "@/lib/config";

/**
 * Same-origin JSON-RPC for wallet pages. Some phone networks and in-app wallet browsers cannot reach the public
 * Robinhood Chain RPC, so balances showed "—". Reads go through here to the server's RPC (then the public one).
 * Only read methods pass; sending transactions always happens in the user's wallet, never here.
 */
const READ = new Set([
  "eth_chainId", "net_version", "eth_blockNumber", "eth_call", "eth_getBalance", "eth_getCode", "eth_getStorageAt",
  "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByNumber",
  "eth_getBlockByHash", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getLogs",
]);
const upstreams = [process.env.RPC_URL, process.env.RPC_URL_BACKUP, ...chain.rpcUrls.default.http].filter((u, i, a): u is string => !!u && a.indexOf(u) === i);

type Req = { id?: unknown; method?: unknown };

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > 64_000) return Response.json({ error: "too large" }, { status: 413 });
  let body: Req | Req[];
  try { body = JSON.parse(text); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const list = Array.isArray(body) ? body : [body];
  if (list.length === 0 || list.length > 50) return Response.json({ error: "batch size" }, { status: 400 });
  const bad = list.find((r) => typeof r?.method !== "string" || !READ.has(r.method as string));
  if (bad) return Response.json({ jsonrpc: "2.0", id: bad?.id ?? null, error: { code: -32601, message: "method not allowed here" } }, { status: 200 });
  for (const url of upstreams) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: AbortSignal.timeout(12_000), cache: "no-store" });
      if (!r.ok) continue;
      return new Response(await r.text(), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
    } catch { /* next upstream */ }
  }
  return Response.json({ error: "upstream unavailable" }, { status: 502 });
}
