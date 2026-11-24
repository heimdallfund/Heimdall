import { describe, it, expect } from "vitest";
import { MemoryStore } from "../src/store.js";
import { countVerdict, recordHeartbeat, status, upsertIncident } from "../src/status.js";

const NOW = Date.UTC(2026, 11, 10, 12);
const rpc = (lag: number) => async () => ({ block: 123_456n, timestamp: BigInt(Math.floor(NOW / 1000) - lag) });

describe("status", () => {
  it("counts checks per UTC day and in total, and reports the head block and RPC time", async () => {
    const s = new MemoryStore();
    await countVerdict(s, "allowed", NOW - 86_400_000);
    await countVerdict(s, "denied", NOW);
    await countVerdict(s, "warned", NOW);
    await countVerdict(s, "allowed", NOW);
    const st = await status(s, rpc(3), NOW);
    expect(st.activity).toMatchObject({ total: 4, allowed: 2, warned: 1, denied: 1, today: 3 });
    expect(st.activity.days).toHaveLength(30);
    expect(st.activity.days.at(-1)).toEqual({ day: "2026-12-10", checks: 3, warned: 1, denied: 1 });
    expect(st.activity.days.at(-2)!.checks).toBe(1);
    expect(st.block).toBe("123456");
    expect(typeof st.services[1]!.ms).toBe("number");
  });

  it("reports each service from heartbeats and probes, with daily uptime", async () => {
    const s = new MemoryStore();
    for (let i = 0; i < 4; i++) await recordHeartbeat(s, "monitor", { shield: i !== 3, rpc: true }, undefined, NOW - (10 - i) * 60_000);
    await recordHeartbeat(s, "keeper", {}, "2 buys", NOW - 45 * 60_000);
    const st = await status(s, rpc(20), NOW);
    expect(Object.fromEntries(st.services.map((x) => [x.id, x.state]))).toEqual({ shield: "ok", rpc: "ok", monitor: "ok", keeper: "degraded" });
    expect(st.uptime.shield!.at(-1)).toEqual({ day: "2026-12-10", pct: 75 });
    expect(st.uptime.rpc!.at(-1)!.pct).toBe(100);
    expect(st.uptime.shield![0]!.pct).toBeNull();
    expect(st.overall).toBe("degraded");
  });

  it("marks a lagging or silent RPC, and open incidents make the page red until resolved", async () => {
    const s = new MemoryStore();
    expect((await status(s, rpc(600), NOW)).services[1]!.state).toBe("down");
    expect((await status(s, async () => { throw new Error("x"); }, NOW)).services[1]).toMatchObject({ state: "down", detail: "No answer" });
    expect((await upsertIncident(s, { title: "", status: "investigating", body: "x" })).ok).toBe(false);
    const a = await upsertIncident(s, { title: "Wallet Check slow", status: "investigating", body: "Scans take minutes." }, NOW);
    expect(a.ok).toBe(true);
    const id = (a as { incident: { id: string } }).incident.id;
    expect((await status(s, rpc(5), NOW)).overall).toBe("down");
    await upsertIncident(s, { id, status: "resolved", body: "RPC provider fixed." }, NOW + 3_600_000);
    const st = await status(s, rpc(5), NOW);
    expect(st.incidents[0]).toMatchObject({ status: "resolved", resolved: NOW + 3_600_000 });
    expect(st.incidents[0]!.updates).toHaveLength(2);
  });
});
