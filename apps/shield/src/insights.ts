import type { CounterStore } from "./store.js";
import { blocklistEntries } from "./blocklist.js";

/**
 * Public insights built from checks: per-agent counters, a Threat Board (finding codes, most-denied
 * targets, recent denials) and shareable verdicts. Everything is aggregate or opt-in (share: true).
 */
const DAY = 86_400;
const KEEP = 35 * DAY;
const RECENT = 50;
const VERDICT_TTL = 90 * DAY;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface Finding { code: string; severity: string; message?: string }
interface ResultLike { checkId: string; verdict: "ALLOW" | "WARN" | "DENY"; riskScore: number; summary: string[]; findings: Finding[] }

export async function recordCheck(store: CounterStore, input: { kind: "tx" | "sig"; wallet: string; target: string | null; result: ResultLike; now?: number }) {
  const now = input.now ?? Date.now();
  const w = input.wallet.toLowerCase();
  const bucket = input.result.verdict === "ALLOW" ? "allowed" : input.result.verdict === "WARN" ? "warned" : "denied";
  const ops: Promise<unknown>[] = [
    store.incr(`agent:${w}:checks`, 10 * 365 * DAY),
    store.incr(`agent:${w}:${bucket}`, 10 * 365 * DAY),
    store.put(`agent:${w}:last`, String(now)),
  ];
  if (!(await store.fetch(`agent:${w}:first`))) ops.push(store.put(`agent:${w}:first`, String(now)));
  const day = dayKey(now);
  for (const f of input.result.findings) {
    if (f.severity !== "deny" && f.severity !== "warn") continue;
    ops.push(store.incr(`threat:code:${day}:${f.code}`, KEEP), store.addMember("threat:codes", f.code));
  }
  if (input.result.verdict === "DENY") {
    const t = input.target?.toLowerCase();
    if (t) ops.push(store.incr(`threat:target:${t}`, KEEP), store.addMember("threat:targets", t));
    const seq = await store.incr("threat:recent:seq", 10 * 365 * DAY);
    ops.push(store.put(`threat:recent:${seq % RECENT}`, JSON.stringify({
      at: now, kind: input.kind, target: t ?? null,
      codes: input.result.findings.filter((f) => f.severity === "deny").map((f) => f.code).slice(0, 3),
      summary: input.result.summary[0] ?? "",
    }), KEEP));
  }
  await Promise.all(ops);
}

export async function saveVerdict(store: CounterStore, id: string, payload: unknown) {
  await store.put(`verdict:${id.toLowerCase()}`, JSON.stringify(payload), VERDICT_TTL);
}

export async function loadVerdict(store: CounterStore, id: string): Promise<unknown | null> {
  const raw = await store.fetch(`verdict:${id.toLowerCase()}`);
  return raw ? JSON.parse(raw) : null;
}

export async function agentStats(store: CounterStore, wallet: string) {
  const w = wallet.toLowerCase();
  const [checks, allowed, warned, denied] = await Promise.all(["checks", "allowed", "warned", "denied"].map((k) => store.get(`agent:${w}:${k}`)));
  const [first, last] = await Promise.all([store.fetch(`agent:${w}:first`), store.fetch(`agent:${w}:last`)]);
  return { address: wallet, checks, allowed, warned, denied, firstSeen: first ? Number(first) : null, lastSeen: last ? Number(last) : null };
}

export async function threats(store: CounterStore, now = Date.now(), days = 7) {
  const codes = await store.members("threat:codes");
  const dayKeys = Array.from({ length: days }, (_, i) => dayKey(now - i * DAY * 1000));
  const codeCounts = await Promise.all(codes.map(async (code) => ({
    code, count: (await Promise.all(dayKeys.map((d) => store.get(`threat:code:${d}:${code}`)))).reduce((a, b) => a + b, 0),
  })));
  const targets = await store.members("threat:targets");
  const targetCounts = (await Promise.all(targets.map(async (address) => ({ address, denies: await store.get(`threat:target:${address}`) }))))
    .filter((t) => t.denies > 0).sort((a, b) => b.denies - a.denies).slice(0, 25);
  const recent = (await Promise.all(Array.from({ length: RECENT }, (_, i) => store.fetch(`threat:recent:${i}`))))
    .filter((x): x is string => !!x).map((x) => JSON.parse(x) as { at: number }).sort((a, b) => b.at - a.at).slice(0, 20);
  const blocklist = blocklistEntries();
  const blocked = new Set(blocklist.map((b) => b.address.toLowerCase()));
  return {
    window: `${days}d`,
    codes: codeCounts.filter((c) => c.count > 0).sort((a, b) => b.count - a.count),
    targets: targetCounts.map((t) => ({ ...t, blocklisted: blocked.has(t.address) })),
    recent,
    blocklist,
  };
}
