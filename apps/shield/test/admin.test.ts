import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildApp } from "../src/server.js";
import { MemoryStore } from "../src/store.js";
import { limitsFromEnv } from "../src/limits.js";
import { normalizePath } from "../src/admin.js";
import { isBlocklisted, resetBlocklist } from "../src/blocklist.js";

const KEY = "admin-secret-for-tests";
const HB = "heartbeat-only-key";
const env = { NODE_ENV: "test", SHIELD_ADMIN_KEY_SHA256: createHash("sha256").update(KEY).digest("hex"), SHIELD_HEARTBEAT_KEY_SHA256: createHash("sha256").update(HB).digest("hex"), ARENA_SEASONS: JSON.stringify([{ id: 1, name: "From env", start: 0, end: 4_000_000_000_000, minTvl: 0, minDepositors: 0 }]) } as NodeJS.ProcessEnv;
function setup() {
  const store = new MemoryStore();
  const app = buildApp({ env, getClient: () => ({}) as never, store, limits: limitsFromEnv(env), log: () => {} });
  const req = (path: string, init: RequestInit & { admin?: boolean } = {}) =>
    app.request(path, { ...init, headers: { "content-type": "application/json", ...(init.admin === false ? {} : { "x-admin-key": KEY }), ...(init.headers as Record<string, string>) } });
  return { store, req };
}
const ADDR = "0x9999999999999999999999999999999999999999";

describe("admin panel API", () => {
  it("lets the narrow heartbeat key post status heartbeats and nothing else", async () => {
    const { req } = setup();
    const hb = (key: string) => req("/v1/admin/heartbeat", { admin: false, method: "POST", headers: { "x-heartbeat-key": key }, body: JSON.stringify({ service: "monitor", probes: { shield: true, rpc: true } }) });
    expect((await hb(HB)).status).toBe(204);
    expect((await hb("wrong")).status).toBe(403);
    expect((await hb(KEY)).status).toBe(403);
    expect((await req("/v1/admin/launch", { admin: false, headers: { "x-heartbeat-key": HB } })).status).toBe(403);
    expect((await req("/v1/admin/blocklist", { admin: false, headers: { "x-heartbeat-key": HB } })).status).toBe(403);
    expect((await req("/v1/admin/heartbeat", { method: "POST", body: JSON.stringify({ service: "keeper" }) })).status).toBe(204);
    const st = await (await req("/v1/status", { admin: false })).json() as { services: { id: string; state: string }[] };
    expect(st.services.find((s) => s.id === "monitor")!.state).toBe("ok");
  });

  it("keeps the launch-day checklist, admin only, and drops anything malformed", async () => {
    const { req } = setup();
    expect((await req("/v1/admin/launch", { admin: false })).status).toBe(403);
    expect(await (await req("/v1/admin/launch")).json()).toEqual({});
    const body = { "deploy-core": { at: 1, note: "tx 0xabc" }, "Bad Id!": { at: 2 }, "no-time": { note: "x" } };
    expect(await (await req("/v1/admin/launch", { method: "PUT", body: JSON.stringify(body) })).json()).toEqual({ "deploy-core": { at: 1, note: "tx 0xabc" } });
    expect(await (await req("/v1/admin/launch")).json()).toEqual({ "deploy-core": { at: 1, note: "tx 0xabc" } });
    expect((await req("/v1/admin/launch", { method: "PUT", body: "[]" })).status).toBe(400);
  });

  it("refuses every admin route without the key", async () => {
    const { req } = setup();
    for (const [m, p] of [["GET", "/v1/admin/overview"], ["GET", "/v1/admin/analytics"], ["PUT", "/v1/admin/arena/seasons"], ["DELETE", `/v1/admin/blocklist/${ADDR}`]]) {
      expect((await req(p!, { method: m, admin: false, body: m === "PUT" ? "[]" : undefined })).status).toBe(403);
      expect((await req(p!, { method: m, headers: { "x-admin-key": "wrong" }, body: m === "PUT" ? "[]" : undefined })).status).toBe(403);
    }
  });

  it("confirms a report, logs it, then undoes the block", async () => {
    resetBlocklist();
    const { store, req } = setup();
    const { submitReport } = await import("../src/points.js");
    const rep = await submitReport(store, { reporter: "0x1111111111111111111111111111111111111111", address: ADDR, evidence: "https://example.org/tx" });
    expect((await (await req("/v1/admin/overview")).json()).pendingReports).toBe(1);
    expect((await req(`/v1/reports/${rep.id}/decision`, { method: "POST", body: JSON.stringify({ confirm: true }) })).status).toBe(200);
    expect(isBlocklisted(ADDR)).toBe(true);
    const decisions = await (await req("/v1/admin/decisions")).json();
    expect(decisions[0]).toMatchObject({ id: rep.id, status: "confirmed", by: "admin" });
    expect(await (await req("/v1/admin/blocklist")).json()).toHaveLength(1);
    expect(await (await req(`/v1/admin/blocklist/${ADDR}`, { method: "DELETE" })).json()).toEqual({ removed: true });
    expect(isBlocklisted(ADDR)).toBe(false);
    expect(await store.members("blocklist:community")).toEqual([]);
  });

  it("edits Arena seasons at runtime, validating them, and the public board follows", async () => {
    const { req } = setup();
    expect((await (await req("/v1/arena", { admin: false })).json()).season.name).toBe("From env");
    const bad = await req("/v1/admin/arena/seasons", { method: "PUT", body: JSON.stringify([{ id: 1, name: "", start: 2, end: 1, minTvl: 0, minDepositors: 0 }]) });
    expect(bad.status).toBe(400);
    const s1 = { id: 1, name: "Season 1", start: Date.UTC(2026, 11, 1), end: Date.UTC(2026, 11, 31), minTvl: 500, minDepositors: 3, prize: "1,000 USDG" };
    expect((await req("/v1/admin/arena/seasons", { method: "PUT", body: JSON.stringify([s1]) })).status).toBe(200);
    expect((await (await req("/v1/arena", { admin: false })).json()).season).toMatchObject({ name: "Season 1", prize: "1,000 USDG" });
    expect((await (await req("/v1/admin/overview")).json()).seasonsSource).toBe("admin");
  });

  it("counts allowlisted events and strips addresses from paths", async () => {
    const { req } = setup();
    for (const b of [{ name: "pageview", path: `/check/${ADDR}` }, { name: "pageview", path: `/check/${ADDR}?x=1` }, { name: "pageview", path: "/pay/job/42" }, { name: "wallet_check" }, { name: "evil_event" }]) {
      await req("/v1/events", { method: "POST", admin: false, body: JSON.stringify(b) });
    }
    const a = await (await req("/v1/admin/analytics?days=1")).json();
    expect(a.totals).toMatchObject({ pageview: 3, wallet_check: 1 });
    expect(a.totals.evil_event).toBeUndefined();
    expect(a.topPages).toEqual([{ path: "/check/:address", views: 2 }, { path: "/pay/job/:id", views: 1 }]);
    expect(normalizePath("javascript:alert(1)")).toBeNull();
    expect(normalizePath("/tx/0x" + "ab".repeat(32))).toBe("/tx/:hash");
  });
});
