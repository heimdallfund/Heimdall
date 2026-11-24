import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer, VERSION } from "@heimdallfund/mcp";
import { HeimdallShield, robinhoodChain } from "@heimdallfund/sdk";
import { createPublicClient, http, type Address, type PublicClient } from "viem";

/**
 * The Heimdall MCP server over Streamable HTTP, stateless: every POST builds a fresh server, so any instance can
 * answer any request. Tool calls reach the Shield API with the caller's own API key when they send one; otherwise
 * they go through the relay headers, so the free tier is counted per caller and not for this host as a whole.
 */
export type Env = Record<string, string | undefined>;

const IP = /^[0-9a-fA-F:.]{2,45}$/;

export function callerIp(req: Request): string | undefined {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined;
  return ip && IP.test(ip) ? ip : undefined;
}

export function callerKey(req: Request): string | undefined {
  const a = req.headers.get("authorization");
  const k = a?.startsWith("Bearer ") ? a.slice(7).trim() : req.headers.get("x-api-key") ?? undefined;
  return k && /^[\w-]{8,200}$/.test(k) ? k : undefined;
}

/** fetch for the Shield client: adds the relay credential and the caller's IP, never anything the caller sent. */
export function relayFetch(env: Env, ip: string | undefined, base: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (env.SHIELD_RELAY_KEY && ip) { headers.set("x-heimdall-relay", env.SHIELD_RELAY_KEY); headers.set("x-heimdall-client-ip", ip); }
    return base(input, { ...init, headers });
  };
}

let client: PublicClient | undefined;

export async function handle(req: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization, x-api-key, mcp-protocol-version, mcp-session-id", "access-control-expose-headers": "mcp-session-id", "access-control-allow-methods": "POST, GET, OPTIONS" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method === "GET") {
    return Response.json({ name: "Heimdall MCP", version: VERSION, transport: "streamable-http", endpoint: "POST this URL", docs: "https://heimdall.fund/docs/mcp" }, { headers: cors });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: { ...cors, allow: "POST, GET, OPTIONS" } });
  if (Number(req.headers.get("content-length") ?? 0) > 256 * 1024) return new Response("payload too large", { status: 413, headers: cors });

  const key = callerKey(req);
  client ??= createPublicClient({ chain: robinhoodChain, transport: http(env.RPC_URL) }) as PublicClient;
  const server = buildServer({
    shield: new HeimdallShield({ baseUrl: env.HEIMDALL_API_URL, apiKey: key, fetch: key ? fetchImpl : relayFetch(env, callerIp(req), fetchImpl) }),
    client,
    chainId: robinhoodChain.id,
    signals: env.HEIMDALL_SIGNALS_ADDRESS as Address | undefined,
    factory: env.HEIMDALL_FACTORY_ADDRESS as Address | undefined,
    pay: env.HEIMDALL_PAY_ADDRESS as Address | undefined,
    riskOracle: env.HEIMDALL_RISK_ORACLE_ADDRESS as Address | undefined,
    webUrl: (env.HEIMDALL_WEB_URL ?? "https://heimdall.fund").replace(/\/$/, ""),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const res = await transport.handleRequest(req);
    const out = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) out.set(k, v);
    return new Response(res.body, { status: res.status, headers: out });
  } finally {
    void transport.close(); void server.close();
  }
}
