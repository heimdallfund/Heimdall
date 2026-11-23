import type { Address } from "viem";
import { decodeVoucherHeader, encodeVoucherHeader, type SignedVoucher, type VoucherLedger } from "@heimdallfund/sdk";

/** Upstash Redis (REST) ledger with an atomic compare-and-set, safe across many server instances. */
export class UpstashLedger implements VoucherLedger {
  constructor(private url: string, private token: string, private fetchImpl: typeof fetch = fetch) {}

  private async cmd(...args: (string | number)[]): Promise<unknown> {
    const res = await this.fetchImpl(this.url.replace(/\/$/, ""), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    return ((await res.json()) as { result: unknown }).result;
  }

  private key = (p: Address, id: bigint) => `sig:acc:${id}:${p.toLowerCase()}`;

  async getAccepted(p: Address, id: bigint) {
    const v = await this.cmd("GET", this.key(p, id));
    return v ? BigInt(String(v)) : 0n;
  }

  async advance(p: Address, id: bigint, expected: bigint, next: bigint, v: SignedVoucher) {
    const script = `local cur = redis.call('GET', KEYS[1]) or '0'
if cur ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('HSET', KEYS[2], ARGV[3], ARGV[4])
return 1`;
    const r = await this.cmd("EVAL", script, 2, this.key(p, id), `sig:latest:${id}`, expected.toString(), next.toString(), p.toLowerCase(), encodeVoucherHeader(v));
    return Number(r) === 1;
  }

  async pending(id: bigint) {
    const flat = ((await this.cmd("HGETALL", `sig:latest:${id}`)) as string[]) ?? [];
    const out: SignedVoucher[] = [];
    for (let i = 1; i < flat.length; i += 2) out.push(decodeVoucherHeader(flat[i]!));
    return out;
  }
}
