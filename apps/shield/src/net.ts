/**
 * Outbound requests to addresses someone else chose (webhook URLs, ERC-8004 registration files) must never reach
 * this machine or a private network. Hostnames are resolved first and every address they point to is checked, so
 * a public name that resolves to 10.0.0.1 or 127.0.0.1 is refused too.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(x)) {
      const [hi, lo] = x.slice(7).split(":").map((h) => parseInt(h, 16)) as [number, number];
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return x === "::" || x === "::1" || /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x) || x.startsWith("64:ff9b:") || x.startsWith("2001:db8:");
  }
  return true;
}

export type Resolver = (host: string) => Promise<string[]>;
const systemResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

/** null when the URL is https (or http when allowed), public, and every address of its host is public. */
export async function publicUrlProblem(raw: string, opts: { allowHttp?: boolean; resolve?: Resolver } = {}): Promise<string | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return "not a valid URL"; }
  if (u.protocol !== "https:" && !(opts.allowHttp && u.protocol === "http:")) return "https only";
  if (u.username || u.password) return "credentials in the URL";
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return "private hostname";
  if (isIP(host)) return isPrivateIp(host) ? "private address" : null;
  let ips: string[];
  try { ips = await (opts.resolve ?? systemResolver)(host); } catch { return "hostname does not resolve"; }
  if (!ips.length) return "hostname does not resolve";
  return ips.some(isPrivateIp) ? "resolves to a private address" : null;
}

/** Reads at most `max` bytes of a response body; null when it is longer. */
export async function readCapped(res: Response, max: number): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
