import { describe, it, expect } from "vitest";
import { buildApp } from "../src/server.js";
import { MemoryStore } from "../src/store.js";
import { limitsFromEnv } from "../src/limits.js";

describe("OpenAPI", () => {
  it("serves an OpenAPI 3.1 spec to any origin, with request bodies from the validating schemas", async () => {
    const env = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
    const app = buildApp({ env, getClient: () => ({}) as never, store: new MemoryStore(), limits: limitsFromEnv(env), log: () => {} });
    const r = await app.request("/openapi.json", { headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const s = await r.json() as { openapi: string; servers: { url: string }[]; paths: Record<string, { post?: { requestBody: { content: Record<string, { schema: { required?: string[]; properties: Record<string, unknown> } }> } } }> };
    expect(s.openapi).toBe("3.1.0");
    expect(s.servers[0]!.url).toBe("https://api.heimdall.fund");
    const body = s.paths["/v1/check"]!.post!.requestBody.content["application/json"]!.schema;
    expect(body.required).toContain("from");
    expect(Object.keys(body.properties)).toEqual(expect.arrayContaining(["chainId", "from", "to", "data", "value", "policy"]));
    expect(Object.keys(s.paths)).toEqual(expect.arrayContaining(["/v1/check", "/v1/check-signature", "/v1/risk/{address}", "/health"]));
  });
});
