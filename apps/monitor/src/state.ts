/** Where the cron keeps `State` between runs: Upstash Redis over REST when configured, otherwise this process only. */
import type { Env, State } from "./runner.js";

const KEY = "monitor:state";
let memory: State | null = null;

export async function loadState(env: Env, fallback: State, fetcher: typeof fetch = fetch): Promise<State> {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return memory ?? fallback;
  const r = await fetcher(`${env.UPSTASH_REDIS_REST_URL}/get/${KEY}`, { headers: { authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` } });
  if (!r.ok) throw new Error(`state store answered ${r.status}`);
  const { result } = (await r.json()) as { result: string | null };
  return result ? { ...fallback, ...(JSON.parse(result) as Partial<State>) } : fallback;
}

export async function saveState(env: Env, state: State, fetcher: typeof fetch = fetch) {
  memory = state;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return;
  const r = await fetcher(`${env.UPSTASH_REDIS_REST_URL}/set/${KEY}`, { method: "POST", headers: { authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` }, body: JSON.stringify(state) });
  if (!r.ok) throw new Error(`state store answered ${r.status}`);
}
