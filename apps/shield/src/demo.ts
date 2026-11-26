import type { CounterStore } from "./store.js";

/**
 * Sample transactions from the site's own demos (Shield console presets, "approving a random wallet").
 * They are judged like any other check, but they are not real traffic: they never count in the public
 * stats, the agent counters or the Threat Board.
 */
export const DEMO_ADDRESSES = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
];
/** A Uniswap pool the console uses as a realistic sender. A pool contract never signs, so nothing real comes "from" it. */
export const DEMO_SENDERS = ["0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3"];

const bare = DEMO_ADDRESSES.map((a) => a.slice(2));
const isDemoAddr = (a?: string | null) => !!a && DEMO_ADDRESSES.includes(a.toLowerCase());

export function isDemoTx(tx: { from: string; to?: string | null; data?: string }): boolean {
  const from = tx.from.toLowerCase();
  if (isDemoAddr(from) || DEMO_SENDERS.includes(from) || isDemoAddr(tx.to)) return true;
  const data = (tx.data ?? "").toLowerCase();
  return bare.some((a) => data.includes(a));
}

export function isDemoSig(signer: string, spender?: string | null): boolean {
  return isDemoAddr(signer) || DEMO_SENDERS.includes(signer.toLowerCase()) || isDemoAddr(spender);
}

const BUCKETS = ["checks", "allowed", "warned", "denied"] as const;
const KEEP = 35 * 86_400;
const LONG = 10 * 365 * 86_400;

/**
 * One-time cleanup of demo traffic counted before the filter existed. Every demo check was recorded under its
 * sender's agent counters, so those counters say exactly how much to take back out of the public totals.
 * Guarded by an atomic counter, so it runs once even if several instances start at the same time.
 */
export async function purgeDemoTraffic(store: CounterStore): Promise<boolean> {
  if ((await store.incr("migrate:demo-purge-v1", LONG)) !== 1) return false;
  for (const w of [...DEMO_ADDRESSES, ...DEMO_SENDERS]) {
    const counts = await Promise.all(BUCKETS.map((k) => store.get(`agent:${w}:${k}`)));
    await Promise.all(BUCKETS.map((k, i) => (counts[i]! > 0 ? store.incr(`stats:${k}`, LONG, -counts[i]!) : null)));
    await Promise.all([...BUCKETS, "first", "last"].map((k) => store.remove(`agent:${w}:${k}`)));
    await store.remove(`agent:${w}:peers`);
  }
  // Threat Board: demo targets and the denials they left in the recent list (with the finding codes they added).
  for (const t of DEMO_ADDRESSES) {
    await store.removeMember("threat:targets", t);
    await store.remove(`threat:target:${t}`);
  }
  for (let i = 0; i < 50; i++) {
    const raw = await store.fetch(`threat:recent:${i}`);
    if (!raw) continue;
    const e = JSON.parse(raw) as { at: number; target: string | null; codes?: string[] };
    if (!isDemoAddr(e.target)) continue;
    const day = new Date(e.at).toISOString().slice(0, 10);
    await Promise.all((e.codes ?? []).map((code) => store.incr(`threat:code:${day}:${code}`, KEEP, -1)));
    await store.remove(`threat:recent:${i}`);
  }
  return true;
}

/** Read-side guard for anything that slipped in: demo targets never show on the board. */
export const notDemo = (address: string | null | undefined) => !isDemoAddr(address);
