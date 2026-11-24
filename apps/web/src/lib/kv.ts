/** Minimal Upstash Redis REST client; in-memory fallback for local development. */
const URL_ = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const mem = new Map<string, unknown>();

async function cmd(...args: (string | number)[]): Promise<unknown> {
  if (!URL_ || !TOKEN) return memCmd(args);
  const res = await fetch(URL_.replace(/\/$/, ""), {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`kv ${res.status}`);
  return ((await res.json()) as { result: unknown }).result;
}

function memCmd([op, key, ...rest]: (string | number)[]): unknown {
  const k = String(key);
  switch (op) {
    case "GET": return mem.get(k) ?? null;
    case "SET": mem.set(k, String(rest[0])); return "OK";
    case "RPUSH": { const l = (mem.get(k) as string[]) ?? []; l.push(String(rest[0])); mem.set(k, l); return l.length; }
    case "LTRIM": { const l = (mem.get(k) as string[]) ?? []; mem.set(k, l.slice(Number(rest[0]))); return "OK"; }
    case "LRANGE": { const l = (mem.get(k) as string[]) ?? []; return l.slice(Number(rest[0]), Number(rest[1]) === -1 ? undefined : Number(rest[1]) + 1); }
    default: return null;
  }
}

export const kv = {
  get: async (k: string) => (await cmd("GET", k)) as string | null,
  set: (k: string, v: string) => cmd("SET", k, v),
  push: async (k: string, v: string, keep: number) => { await cmd("RPUSH", k, v); await cmd("LTRIM", k, -keep, -1); },
  range: async (k: string) => ((await cmd("LRANGE", k, 0, -1)) as string[]) ?? [],
};
