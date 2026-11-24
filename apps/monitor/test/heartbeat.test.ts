import { describe, it, expect, vi } from "vitest";
import { heartbeat } from "../src/jobs.js";

describe("status heartbeat", () => {
  it("probes Shield and the RPC and posts the result with the admin key", async () => {
    const calls: { url: string; body?: string; key?: string; hb?: string }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, body: init?.body as string, key: (init?.headers as Record<string, string>)?.["x-admin-key"], hb: (init?.headers as Record<string, string>)?.["x-heartbeat-key"] }); return new Response(null, { status: url.endsWith("/health") ? 200 : 204 }); });
    const client = { getBlock: async () => ({ timestamp: BigInt(Math.floor(Date.now() / 1000) - 3) }) };
    expect(await heartbeat("https://s", "k", "monitor", client as never, undefined, f as never)).toEqual({ shield: true, rpc: true });
    expect(calls.at(-1)).toMatchObject({ url: "https://s/v1/admin/heartbeat", key: "k" });
    await heartbeat("https://s", { heartbeatKey: "hb" }, "monitor", client as never, undefined, f as never);
    expect(calls.at(-1)).toMatchObject({ url: "https://s/v1/admin/heartbeat", hb: "hb", key: undefined });
    expect(JSON.parse(calls.at(-1)!.body!)).toMatchObject({ service: "monitor", probes: { shield: true, rpc: true } });
    const stale = { getBlock: async () => ({ timestamp: 1n }) };
    expect((await heartbeat("https://s", "k", "monitor", stale as never, undefined, f as never)).rpc).toBe(false);
  });
});

describe("Wallet Watch passes", () => {
  it("keeps calling until every watched wallet was scanned once", async () => {
    const { watchAll } = await import("../src/jobs.js");
    let calls = 0;
    const fetcher = (async () => { calls++; return new Response(JSON.stringify({ watched: 450, scanned: calls < 3 ? 200 : 50, notified: calls === 2 ? 1 : 0 }), { status: 200 }); }) as typeof fetch;
    const r = await watchAll("http://shield", "k", 200, fetcher);
    expect(calls).toBe(3);
    expect(r).toEqual({ watched: 450, scanned: 450, notified: 1 });
  });
  it("is off without push keys", async () => {
    const { watchAll } = await import("../src/jobs.js");
    expect(await watchAll("http://shield", "k", 200, (async () => new Response("", { status: 503 })) as typeof fetch)).toBeNull();
  });
});
