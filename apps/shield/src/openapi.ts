import { z } from "zod";
import { CheckBody, SignatureBody } from "./server.js";

/**
 * OpenAPI 3.1 description of the public Shield API. Request bodies are generated from the same zod schemas the
 * server validates with, so the spec cannot drift from what the API accepts.
 */
const input = (s: z.ZodType) => {
  const j = z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete j.$schema;
  return j;
};

const address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", examples: ["0x281FF81dF0Eca1F3F7Ba2A48499c7A83D216a2A8"] };
const json = (schema: unknown, description = "OK") => ({ description, content: { "application/json": { schema } } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const addrParam = { name: "address", in: "path", required: true, schema: address };
const errors = {
  "400": json(ref("Error"), "The request is malformed. Nothing was checked or charged."),
  "402": { description: "Over the free tier. Pay per call with x402: the PAYMENT-REQUIRED header says how (USDG on Robinhood Chain). Retry with a PAYMENT-SIGNATURE header, or use an API key.", headers: { "PAYMENT-REQUIRED": { schema: { type: "string" }, description: "Base64 JSON payment requirements (x402 v2)" } } },
  "429": json(ref("Error"), "Rate limited (when x402 is off)."),
};

export function openApi(serverUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Heimdall Shield API",
      version: "0.2.0",
      summary: "Pre-sign checks for AI agents and wallets on Robinhood Chain.",
      description: "Simulate a transaction or a signature before it is signed and get ALLOW, WARN or DENY with the reasons, the asset changes and, after launch, an EIP-712 receipt a Heimdall vault or Safe guard can verify onchain. Free tier without a key; above it, pay per call with x402 in USDG or use an API key from heimdall.fund/app/keys.",
      contact: { name: "Heimdall", email: "hello@heimdall.fund", url: "https://heimdall.fund/integrate" },
      license: { name: "BUSL-1.1", url: "https://github.com/heimdallfund/Heimdall/blob/main/LICENSE" },
    },
    servers: [{ url: serverUrl, description: "Robinhood Chain mainnet (chain 4663)" }],
    externalDocs: { description: "Guides and SDK", url: "https://heimdall.fund/docs" },
    tags: [
      { name: "Check", description: "Judge a transaction or a signature before signing" },
      { name: "Risk", description: "What Heimdall knows about an address" },
      { name: "Agents", description: "ERC-8004 agent passports and reputation" },
      { name: "Service", description: "Health, status and payment discovery" },
    ],
    security: [{}, { apiKey: [] }, { bearer: [] }],
    paths: {
      "/v1/check": {
        post: {
          tags: ["Check"], operationId: "checkTransaction", summary: "Check a transaction before signing",
          description: "Simulates the call against the current Robinhood Chain state and applies Shield's rules and your policy. Send the exact transaction the agent is about to sign.",
          requestBody: { required: true, content: { "application/json": { schema: input(CheckBody), examples: { approval: { summary: "Unlimited USDG approval to a known drainer", value: { chainId: 4663, from: "0x1111111111111111111111111111111111111111", to: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", data: "0x095ea7b30000000000000000000000002323a3d19c6181b0e854209f405e6fdef6ad821dffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" } } } } } },
          responses: { "200": json(ref("CheckResult"), "The verdict"), ...errors },
        },
      },
      "/v1/check-signature": {
        post: {
          tags: ["Check"], operationId: "checkSignature", summary: "Check an EIP-712 or personal_sign request",
          description: "Catches Permit, Permit2, Seaport and other off-chain signatures that move assets without a transaction. Send exactly one of typedData or message.",
          requestBody: { required: true, content: { "application/json": { schema: input(SignatureBody) } } },
          responses: { "200": json(ref("CheckResult"), "The verdict"), ...errors },
        },
      },
      "/v1/verdicts/{id}": {
        get: { tags: ["Check"], operationId: "getVerdict", summary: "A shared verdict", description: "Verdicts are stored only when the check was sent with share: true.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } }], responses: { "200": json({ type: "object" }), "404": json(ref("Error"), "Not found or expired") } },
      },
      "/v1/risk": {
        get: { tags: ["Risk"], operationId: "listRisk", summary: "Everything the Risk Oracle holds", description: "Addresses with a risk level and flags, as the monitor writes them to the onchain Risk Oracle.", responses: { "200": json({ type: "object", properties: { chainId: { type: "integer" }, oracle: { type: ["string", "null"] }, count: { type: "integer" }, entries: { type: "array", items: ref("RiskEntry") } } }) } },
      },
      "/v1/risk/{address}": {
        get: { tags: ["Risk"], operationId: "getRisk", summary: "Risk level of one address", parameters: [addrParam], responses: { "200": json(ref("RiskEntry")), "400": json(ref("Error"), "Not an address") } },
      },
      "/v1/threats": {
        get: { tags: ["Risk"], operationId: "getThreats", summary: "Threat Board", description: "Most caught patterns, recent denials, most denied addresses and the sourced blocklist.", responses: { "200": json({ type: "object", properties: { window: { type: "string" }, codes: { type: "array", items: { type: "object", properties: { code: { type: "string" }, count: { type: "integer" } } } }, blocklist: { type: "array", items: ref("BlocklistEntry") } } }) } },
      },
      "/v1/wallet/{address}": {
        get: { tags: ["Risk"], operationId: "walletCheck", summary: "Wallet Check: risky approvals of a wallet", parameters: [addrParam], responses: { "200": json({ type: "object" }), ...errors } },
      },
      "/v1/agents/{address}": {
        get: { tags: ["Agents"], operationId: "getAgent", summary: "Shield record of an agent wallet", parameters: [addrParam], responses: { "200": json({ type: "object" }) } },
      },
      "/v1/passport/{id}": {
        get: { tags: ["Agents"], operationId: "getPassport", summary: "Agent passport by ERC-8004 agent ID", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: "^\\d{1,78}$" } }], responses: { "200": json({ type: "object" }), "404": json(ref("Error"), "No such agent") } },
      },
      "/v1/passport": {
        get: { tags: ["Agents"], operationId: "listPassports", summary: "Linked agents, best score first", responses: { "200": json({ type: "array", items: { type: "object" } }) } },
      },
      "/health": {
        get: { tags: ["Service"], operationId: "health", summary: "Liveness and chain head", security: [{}], responses: { "200": json({ type: "object", properties: { ok: { type: "boolean" }, mode: { type: "string", enum: ["prelaunch", "live"] }, block: { type: "string" }, rpcMs: { type: "integer" } } }), "503": json(ref("Error"), "RPC unreachable") } },
      },
      "/v1/status": {
        get: { tags: ["Service"], operationId: "status", summary: "Public status", description: "Services, head block, response times, checks per day, 30 days of uptime and incidents. Same data as heimdall.fund/status.", security: [{}], responses: { "200": json({ type: "object" }) } },
      },
      "/v1/signer": {
        get: { tags: ["Service"], operationId: "signer", summary: "Receipt signer and EIP-712 domain", description: "The address whose receipts Heimdall contracts accept, with the domain and types to verify them yourself.", security: [{}], responses: { "200": json({ type: "object", properties: { signer: { type: ["string", "null"] }, kind: { type: "string" }, domain: { type: "object" }, types: { type: "object" } } }) } },
      },
      "/x402/supported": {
        get: { tags: ["Service"], operationId: "x402Supported", summary: "x402 schemes and networks this facilitator settles", security: [{}], responses: { "200": json({ type: "object" }), "503": json(ref("Error"), "Not live yet") } },
      },
      "/x402/discovery/resources": {
        get: { tags: ["Service"], operationId: "x402Discovery", summary: "x402 Bazaar discovery: every paid resource and its price", security: [{}], responses: { "200": json({ type: "object" }) } },
      },
    },
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "x-api-key", description: "Key from heimdall.fund/app/keys. Lifts the free-tier limit; usage is billed to your account." },
        bearer: { type: "http", scheme: "bearer", description: "The same API key as a Bearer token." },
      },
      schemas: {
        Error: { type: "object", properties: { error: { type: "string" }, message: { type: "string" }, issues: { type: "array", items: { type: "object" } } }, required: ["error"] },
        Finding: { type: "object", properties: { code: { type: "string", examples: ["UNLIMITED_APPROVAL_TO_EOA"] }, severity: { type: "string", enum: ["info", "warn", "deny"] }, message: { type: "string" } }, required: ["code", "severity", "message"] },
        AssetChange: { type: "object", properties: { asset: address, symbol: { type: "string" }, decimals: { type: "integer" }, kind: { type: "string", enum: ["native", "erc20", "erc721"] }, delta: { type: "string", description: "Signed raw amount for the sender; negative leaves the wallet" }, tokenIds: { type: "array", items: { type: "string" } }, counterparties: { type: "array", items: address } } },
        Approval: { type: "object", properties: { standard: { type: "string", enum: ["erc20", "erc721-all", "permit2"] }, token: address, spender: address, amount: { type: "string" }, unlimited: { type: "boolean" }, revoke: { type: "boolean" } } },
        Receipt: { type: "object", description: "EIP-712 receipt (live mode only). Verify it against /v1/signer, or let a Heimdall vault or Safe guard do it onchain.", properties: { signer: address, signature: { type: "string" }, expiresAt: { type: "integer" }, message: { type: "object" } } },
        CheckResult: {
          type: "object", required: ["checkId", "verdict", "riskScore", "summary", "findings"],
          properties: {
            checkId: { type: "string" }, verdict: { type: "string", enum: ["ALLOW", "WARN", "DENY"] }, riskScore: { type: "integer", minimum: 0, maximum: 100 },
            summary: { type: "array", items: { type: "string" } }, findings: { type: "array", items: ref("Finding") },
            decoded: { type: "object", properties: { functionName: { type: "string" }, signature: { type: "string" }, args: { type: "array" } } },
            approvals: { type: "array", items: ref("Approval") }, assetChanges: { type: "array", items: ref("AssetChange") },
            simulation: { type: "object", properties: { ok: { type: "boolean" }, available: { type: "boolean" }, gasUsed: { type: "string" }, revertReason: { type: "string" } } },
            receipt: ref("Receipt"), shareId: { type: "string" },
          },
        },
        RiskEntry: { type: "object", properties: { address, level: { type: "integer", minimum: 0, maximum: 3 }, levelName: { type: "string" }, flags: { type: "integer" }, flagNames: { type: "array", items: { type: "string" } } } },
        BlocklistEntry: { type: "object", properties: { address, label: { type: "string" }, source: { type: "string", format: "uri" }, addedAt: { type: "string", format: "date" } }, required: ["address"] },
      },
    },
  };
}
