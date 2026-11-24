import { isAddress } from "viem";

/**
 * Agent2Agent (A2A, v1.0) over JSON-RPC: another agent can ask Heimdall to check a transaction, a signature or an
 * address. Each request runs through the same REST routes (same validation, free tier, x402 and API keys) and comes
 * back as a completed task with the verdict as structured data and as one readable line.
 * The legacy v0.3 method name `message/send` is accepted too.
 */
export const A2A_VERSION = "1.0";

type Part = { text?: string; data?: unknown; mediaType?: string; kind?: string; metadata?: Record<string, unknown> };
type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: { message?: { messageId?: string; contextId?: string; parts?: Part[] } } };
type Call = (path: string, init?: RequestInit) => Promise<Response>;

export function agentCard(baseUrl: string) {
  return {
    name: "Heimdall Shield",
    description: "Pre-sign firewall for AI agents on Robinhood Chain (chain 4663). Send a transaction, a signature request or an address and get ALLOW, WARN or DENY with the reasons, simulated on the current chain state. Never sign on DENY.",
    version: "0.2.0",
    provider: { organization: "Heimdall", url: "https://heimdall.fund" },
    documentationUrl: "https://heimdall.fund/docs/api",
    iconUrl: "https://heimdall.fund/icon.svg",
    supportedInterfaces: [{ url: `${baseUrl}/a2a`, protocolBinding: "JSONRPC", protocolVersion: A2A_VERSION }],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: [
      {
        id: "check-transaction", name: "Check a transaction before signing",
        description: "Simulates an EVM transaction on Robinhood Chain: drainer approvals, honeypots, fake tokens, address poisoning, blocklisted addresses, reverts and spend limits. Send a data part {from, to, data, value} (wei as a string) and optionally a policy.",
        tags: ["security", "transaction", "simulation", "robinhood-chain", "firewall"],
        examples: ['{"from":"0x…","to":"0x…","data":"0x095ea7b3…","value":"0"}'],
        inputModes: ["application/json"], outputModes: ["application/json", "text/plain"],
      },
      {
        id: "check-signature", name: "Check a signature request before signing",
        description: "Judges an EIP-712 typed-data request (Permit, Permit2, orders) or a personal_sign message. Send a data part {signer, typedData} or {signer, message}.",
        tags: ["security", "signature", "permit", "eip-712"],
        examples: ['{"signer":"0x…","typedData":{"primaryType":"Permit","domain":{…},"message":{…}}}'],
        inputModes: ["application/json"], outputModes: ["application/json", "text/plain"],
      },
      {
        id: "check-address", name: "Is this address safe?",
        description: "Risk level and flags of an address from the Heimdall Risk Oracle list and blocklist. Send a text part with the address, or a data part {address}.",
        tags: ["security", "address", "risk", "blocklist"],
        examples: ["Is 0x281FF81dF0Eca1F3F7Ba2A48499c7A83D216a2A8 safe?"],
        inputModes: ["text/plain", "application/json"], outputModes: ["application/json", "text/plain"],
      },
    ],
  };
}

const rpcError = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function readInput(parts: Part[]): { skill: "tx" | "sig" | "address"; body: Record<string, unknown> } | { error: string } {
  for (const p of parts) {
    let d = p.data as Record<string, unknown> | undefined;
    if (!d && typeof p.text === "string" && p.text.trim().startsWith("{")) { try { d = JSON.parse(p.text) as Record<string, unknown>; } catch { /* not JSON */ } }
    if (d && typeof d === "object") {
      if ("signer" in d) return { skill: "sig", body: d };
      if ("from" in d) return { skill: "tx", body: d };
      if (typeof d.address === "string") return { skill: "address", body: d };
    }
  }
  const text = parts.map((p) => p.text ?? "").join(" ");
  const found = text.match(/0x[0-9a-fA-F]{40}/g) ?? [];
  if (found.length === 1 && isAddress(found[0]!)) return { skill: "address", body: { address: found[0] } };
  return { error: "Send a data part with {from, to, data, value} for a transaction, {signer, typedData | message} for a signature, or one address." };
}

const line = (skill: string, r: Record<string, unknown>) => {
  if (skill === "address") return `${String(r.address ?? "")}: ${String(r.levelName ?? "unknown")}${Array.isArray(r.flagNames) && r.flagNames.length ? ` (${r.flagNames.join(", ")})` : ""}.`;
  const findings = (r.findings as { severity: string; message: string }[] | undefined)?.filter((f) => f.severity !== "info").map((f) => f.message) ?? [];
  const v = String(r.verdict ?? "UNKNOWN");
  return `Verdict: ${v}.${findings.length ? ` ${findings.join(" ")}` : ""}${v === "DENY" ? " Do not sign." : v === "WARN" ? " Sign only if the user confirms." : ""}`;
};

/** Handles one JSON-RPC request. `call` runs a REST route of this same API with the caller's headers. */
export async function handleA2A(rpc: Rpc, call: Call, now = Date.now()): Promise<unknown> {
  if (rpc?.jsonrpc !== "2.0" || typeof rpc.method !== "string") return rpcError(rpc?.id, -32600, "Invalid Request");
  const legacy = rpc.method === "message/send";
  if (rpc.method === "GetTask" || rpc.method === "tasks/get") return rpcError(rpc.id, -32001, "Task not found: tasks complete in the response and are not kept.");
  if (rpc.method !== "SendMessage" && !legacy) return rpcError(rpc.id, -32004, `Unsupported operation: ${rpc.method}. Use SendMessage.`);
  const msg = rpc.params?.message;
  if (!msg || !Array.isArray(msg.parts) || !msg.parts.length) return rpcError(rpc.id, -32602, "Invalid params: message.parts is required");

  const id = crypto.randomUUID();
  const contextId = typeof msg.contextId === "string" ? msg.contextId : crypto.randomUUID();
  const timestamp = new Date(now).toISOString();
  const done = (state: "COMPLETED" | "FAILED" | "REJECTED" | "AUTH_REQUIRED", text: string, data?: unknown, meta?: Record<string, unknown>) => {
    const parts: Part[] = [{ text, mediaType: "text/plain" }, ...(data !== undefined ? [{ data, mediaType: "application/json" }] : [])];
    if (legacy) {
      return { jsonrpc: "2.0", id: rpc.id ?? null, result: { kind: "task", id, contextId, status: { state: state.toLowerCase().replace("_", "-"), timestamp }, artifacts: [{ artifactId: `${id}-result`, name: "verdict", parts: parts.map((p) => (p.data !== undefined ? { kind: "data", data: p.data } : { kind: "text", text: p.text })) }], ...(meta ? { metadata: meta } : {}) } };
    }
    return { jsonrpc: "2.0", id: rpc.id ?? null, result: { task: { id, contextId, status: { state: `TASK_STATE_${state}`, timestamp }, artifacts: [{ artifactId: `${id}-result`, name: "verdict", parts }], ...(meta ? { metadata: meta } : {}) } } };
  };

  const input = readInput(msg.parts);
  if ("error" in input) return done("REJECTED", input.error);
  const res = input.skill === "address"
    ? await call(`/v1/risk/${input.body.address as string}`)
    : await call(input.skill === "tx" ? "/v1/check" : "/v1/check-signature", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input.body) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 402) return done("AUTH_REQUIRED", "Over the free tier: pay per check with x402 (USDG on Robinhood Chain) or send an API key.", body, { paymentRequired: res.headers.get("payment-required") });
  if (res.status === 429) return done("REJECTED", "Rate limited: try again in a minute, or send an API key.", body);
  if (res.status >= 400) return done(res.status >= 500 ? "FAILED" : "REJECTED", `${String(body.message ?? body.error ?? `HTTP ${res.status}`)}${input.skill !== "address" ? " Treat the request as unsafe." : ""}`, body);
  return done("COMPLETED", line(input.skill, body), body);
}
