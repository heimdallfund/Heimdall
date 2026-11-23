/** Counter store for rate limits, quotas and usage. Memory for dev/tests, Upstash Redis (REST) for production. */
export interface CounterStore {
  /** Increment `key` by `by` (default 1), setting a TTL on first write. Returns the new value. */
  incr(key: string, ttlSeconds: number, by?: number): Promise<number>;
  get(key: string): Promise<number>;
  /** String values (JSON) with optional TTL. */
  put(key: string, value: string, ttlSeconds?: number): Promise<void>;
  fetch(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
  /** Set membership. */
  addMember(key: string, member: string): Promise<void>;
  removeMember(key: string, member: string): Promise<void>;
  members(key: string): Promise<string[]>;
}

export class MemoryStore implements CounterStore {
  private m = new Map<string, { v: number; exp: number }>();
  private s = new Map<string, { v: string; exp: number }>();
  private sets = new Map<string, Set<string>>();
  constructor(private now: () => number = Date.now) {}

  private live(key: string) {
    const e = this.m.get(key);
    if (e && e.exp <= this.now()) {
      this.m.delete(key);
      return undefined;
    }
    return e;
  }

  async incr(key: string, ttlSeconds: number, by = 1) {
    const e = this.live(key);
    if (e) {
      e.v += by;
      return e.v;
    }
    this.m.set(key, { v: by, exp: this.now() + ttlSeconds * 1000 });
    if (this.m.size > 100_000) this.sweep();
    return by;
  }

  async get(key: string) {
    return this.live(key)?.v ?? 0;
  }

  async put(key: string, value: string, ttlSeconds?: number) {
    this.s.set(key, { v: value, exp: ttlSeconds ? this.now() + ttlSeconds * 1000 : Infinity });
  }

  async fetch(key: string) {
    const e = this.s.get(key);
    if (!e) return null;
    if (e.exp <= this.now()) { this.s.delete(key); return null; }
    return e.v;
  }

  async remove(key: string) { this.s.delete(key); this.m.delete(key); }
  async addMember(key: string, member: string) { (this.sets.get(key) ?? this.sets.set(key, new Set()).get(key)!).add(member); }
  async removeMember(key: string, member: string) { this.sets.get(key)?.delete(member); }
  async members(key: string) { return [...(this.sets.get(key) ?? [])]; }

  private sweep() {
    const t = this.now();
    for (const [k, e] of this.m) if (e.exp <= t) this.m.delete(k);
  }
}

export class UpstashStore implements CounterStore {
  constructor(private url: string, private token: string, private fetchImpl: typeof fetch = fetch) {}

  private async pipeline(cmds: (string | number)[][]): Promise<{ result: unknown }[]> {
    const res = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(cmds),
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    return (await res.json()) as { result: unknown }[];
  }

  async incr(key: string, ttlSeconds: number, by = 1) {
    const [r] = await this.pipeline([by === 1 ? ["INCR", key] : ["INCRBY", key, by], ["EXPIRE", key, ttlSeconds, "NX"]]);
    return Number(r?.result ?? 0);
  }

  async get(key: string) {
    const [r] = await this.pipeline([["GET", key]]);
    return Number(r?.result ?? 0);
  }

  async put(key: string, value: string, ttlSeconds?: number) {
    await this.pipeline([ttlSeconds ? ["SET", key, value, "EX", ttlSeconds] : ["SET", key, value]]);
  }

  async fetch(key: string) {
    const [r] = await this.pipeline([["GET", key]]);
    return (r?.result as string | null) ?? null;
  }

  async remove(key: string) { await this.pipeline([["DEL", key]]); }
  async addMember(key: string, member: string) { await this.pipeline([["SADD", key, member]]); }
  async removeMember(key: string, member: string) { await this.pipeline([["SREM", key, member]]); }
  async members(key: string) {
    const [r] = await this.pipeline([["SMEMBERS", key]]);
    return (r?.result as string[]) ?? [];
  }
}

export function storeFromEnv(env: NodeJS.ProcessEnv = process.env): CounterStore {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    return new UpstashStore(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  }
  return new MemoryStore();
}
