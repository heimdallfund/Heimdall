import type { CounterStore } from "./store.js";

/**
 * Public status: live state of Shield, the Robinhood Chain RPC, the monitor and the keeper, 30 days of uptime from the
 * monitor's probes, and incidents written in the admin panel.
 */
export type ServiceId = "shield" | "rpc" | "monitor" | "keeper";
export type State = "ok" | "degraded" | "down" | "unknown";
export interface Incident { id: string; title: string; status: "investigating" | "identified" | "monitoring" | "resolved"; started: number; resolved?: number; updates: { at: number; status: Incident["status"]; body: string }[] }

const DAY_TTL = 100 * 86_400;
const NAMES: Record<ServiceId, string> = { shield: "Shield API", rpc: "Robinhood Chain RPC", monitor: "Vault monitor", keeper: "Keeper (Auto-Invest, fees)" };
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The monitor reports every tick: its own heartbeat, plus whether Shield and the RPC answered. */
export async function recordHeartbeat(store: CounterStore, service: "monitor" | "keeper", probes: Partial<Record<"shield" | "rpc", boolean>> = {}, detail?: string, now = Date.now()) {
  await store.put(`hb:${service}`, JSON.stringify({ at: now, detail: detail?.slice(0, 200) }), 30 * 86_400);
  for (const [svc, ok] of Object.entries(probes)) {
    await store.incr(`up:${day(now)}:${svc}:total`, DAY_TTL);
    if (ok) await store.incr(`up:${day(now)}:${svc}:ok`, DAY_TTL);
  }
  if (service === "monitor") { await store.incr(`up:${day(now)}:monitor:total`, DAY_TTL); await store.incr(`up:${day(now)}:monitor:ok`, DAY_TTL); }
}

function ageState(at: number | undefined, now: number, okMin: number, degradedMin: number): State {
  if (!at) return "unknown";
  const m = (now - at) / 60_000;
  return m <= okMin ? "ok" : m <= degradedMin ? "degraded" : "down";
}

export async function status(store: CounterStore, rpc: () => Promise<{ block: bigint; timestamp: bigint; provider?: { name: string; primary: boolean } }>, now = Date.now()) {
  const hb = async (s: string) => JSON.parse((await store.fetch(`hb:${s}`)) ?? "null") as { at: number; detail?: string } | null;
  const [monitor, keeper] = await Promise.all([hb("monitor"), hb("keeper")]);
  let rpcState: State = "down", rpcDetail = "No answer";
  try {
    const b = await Promise.race([rpc(), new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 4_000))]);
    const lag = Math.max(0, Math.round(now / 1000 - Number(b.timestamp)));
    rpcState = lag <= 60 ? "ok" : lag <= 300 ? "degraded" : "down";
    rpcDetail = `Block ${b.block.toLocaleString("en-US")} · ${lag}s ago${b.provider ? ` · via ${b.provider.name}` : ""}`;
    // serving from a backup works, but the main provider is down: say so
    if (b.provider && !b.provider.primary && rpcState === "ok") { rpcState = "degraded"; rpcDetail += " (backup)"; }
  } catch { /* down */ }
  const services: { id: ServiceId; name: string; state: State; detail: string }[] = [
    { id: "shield", name: NAMES.shield, state: "ok", detail: "Answering" },
    { id: "rpc", name: NAMES.rpc, state: rpcState, detail: rpcDetail },
    { id: "monitor", name: NAMES.monitor, state: ageState(monitor?.at, now, 15, 60), detail: monitor ? `Last check ${Math.round((now - monitor.at) / 60_000)} min ago` : "Not reporting yet" },
    { id: "keeper", name: NAMES.keeper, state: ageState(keeper?.at, now, 30, 180), detail: keeper ? `Last run ${Math.round((now - keeper.at) / 60_000)} min ago` : "Not reporting yet" },
  ];
  const days = Array.from({ length: 30 }, (_, i) => day(now - (29 - i) * 86_400_000));
  // 30 days x 3 services is 180 reads; uptime moves slowly, so it is kept for 10 minutes.
  const uptimeKey = `memo:uptime:${days[29]}`;
  const cachedUptime = await store.fetch(uptimeKey).catch(() => null);
  const uptime = cachedUptime ? (JSON.parse(cachedUptime) as Record<string, { day: string; pct: number | null }[]>) : Object.fromEntries(await Promise.all((["shield", "rpc", "monitor"] as const).map(async (svc) => [svc, await Promise.all(days.map(async (d) => {
    const [ok, total] = await Promise.all([store.get(`up:${d}:${svc}:ok`), store.get(`up:${d}:${svc}:total`)]);
    return { day: d, pct: total ? Math.round((ok / total) * 10_000) / 100 : null };
  }))] as const)));
  if (!cachedUptime) await store.put(uptimeKey, JSON.stringify(uptime), 600).catch(() => {});
  const incidents = await listIncidents(store);
  const open = incidents.filter((i) => i.status !== "resolved");
  const overall: State = open.length || services.some((s) => s.state === "down") ? "down" : services.some((s) => s.state === "degraded") ? "degraded" : "ok";
  return { overall, services, uptime, incidents: incidents.slice(0, 20), updated: now };
}

// ── incidents ────────────────────────────────────────────────────────────────
const STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export async function listIncidents(store: CounterStore): Promise<Incident[]> {
  return JSON.parse((await store.fetch("incidents")) ?? "[]") as Incident[];
}
export async function upsertIncident(store: CounterStore, input: { id?: string; title?: string; status?: string; body?: string }, now = Date.now()) {
  if (!input.status || !(STATUSES as readonly string[]).includes(input.status)) return { ok: false as const, error: "status must be investigating, identified, monitoring or resolved" };
  const body = String(input.body ?? "").trim().slice(0, 1_000);
  if (!body) return { ok: false as const, error: "write what is happening" };
  const list = await listIncidents(store);
  const st = input.status as Incident["status"];
  let inc = input.id ? list.find((i) => i.id === input.id) : undefined;
  if (input.id && !inc) return { ok: false as const, error: "not_found" };
  if (!inc) {
    const title = String(input.title ?? "").trim().slice(0, 120);
    if (!title) return { ok: false as const, error: "title required" };
    inc = { id: now.toString(36), title, status: st, started: now, updates: [] };
    list.unshift(inc);
  }
  inc.status = st;
  inc.updates.unshift({ at: now, status: st, body });
  if (st === "resolved") inc.resolved = now; else delete inc.resolved;
  await store.put("incidents", JSON.stringify(list.slice(0, 100)));
  return { ok: true as const, incident: inc };
}
