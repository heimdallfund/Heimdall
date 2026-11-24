/** Where the cron keeps `State` between runs: Upstash Redis over REST when configured, otherwise this process only. */
import type { Env, State } from "./runner.js";

const KEY = "monitor:state";
/** Upstash REST credentials: its own names, or the KV_REST_API_* names the Vercel Marketplace integration sets. */
function rest(env: Env) {
  const e = env as Record<string, string | undefined>;
  const url = e.UPSTASH_REDIS_REST_URL ?? e.KV_REST_API_URL;
  const token = e.UPSTASH_REDIS_REST_TOKEN ?? e.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}
let memory: State | null = null;

export async function loadState(env: Env, fallback: State, fetcher: typeof fetch = fetch): Promise<State> {
  const db = rest(env);
  if (!db) return memory ?? fallback;
  const r = await fetcher(`${db.url}/get/${KEY}`, { headers: { authorization: `Bearer ${db.token}` } });
  if (!r.ok) throw new Error(`state store answered ${r.status}`);
  const { result } = (await r.json()) as { result: string | null };
  return result ? { ...fallback, ...(JSON.parse(result) as Partial<State>) } : fallback;
}

export async function saveState(env: Env, state: State, fetcher: typeof fetch = fetch) {
  memory = state;
  const db = rest(env);
  if (!db) return;
  const r = await fetcher(`${db.url}/set/${KEY}`, { method: "POST", headers: { authorization: `Bearer ${db.token}` }, body: JSON.stringify(state) });
  if (!r.ok) throw new Error(`state store answered ${r.status}`);
}
