import { describe, expect, it } from "vitest";
import { emptyState, type Env } from "../src/runner.js";
import { loadState, saveState } from "../src/state.js";
import { GET } from "../api/cron.js";

describe("cron runner", () => {
  it("refuses calls without the cron secret", async () => {
    process.env.CRON_SECRET = "s3cret";
    expect((await GET(new Request("https://x/api/cron"))).status).toBe(403);
    expect((await GET(new Request("https://x/api/cron", { headers: { authorization: "Bearer wrong" } }))).status).toBe(403);
    delete process.env.CRON_SECRET;
    expect((await GET(new Request("https://x/api/cron", { headers: { authorization: "Bearer undefined" } }))).status).toBe(403);
  });

  it("keeps state between runs in Upstash, so alerts and daily jobs are not repeated", async () => {
    const kv = new Map<string, string>();
    const fake = (async (url: string, init?: RequestInit) => {
      const [, op, key] = new URL(url).pathname.split("/");
      if (op === "set") { kv.set(key!, String(init!.body)); return Response.json({ result: "OK" }); }
      return Response.json({ result: kv.get(key!) ?? null });
    }) as typeof fetch;
    const env = { UPSTASH_REDIS_REST_URL: "https://kv.example", UPSTASH_REDIS_REST_TOKEN: "t" } as Env;
    const fresh = await loadState(env, emptyState(env), fake);
    expect(fresh.lastDaily).toBe("");
    await saveState(env, { ...fresh, lastDaily: "2026-11-24", active: ["0xabc:loss"] }, fake);
    const again = await loadState(env, emptyState(env), fake);
    expect([again.lastDaily, again.active]).toEqual(["2026-11-24", ["0xabc:loss"]]);
  });
});
