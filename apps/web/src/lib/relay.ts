/**
 * Headers for server-side calls to Shield on behalf of a visitor. Shield counts its free tier per caller IP; from
 * here every call would come from one Vercel IP, so the visitor's IP goes along with the relay key (SHIELD_RELAY_KEY),
 * which is the only way Shield accepts an IP it did not see itself.
 */
export function visitorIp(h: Headers): string | undefined {
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : undefined;
}

export function relayHeaders(h: Headers | null | undefined, extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = { ...extra };
  if (process.env.SHIELD_API_KEY) out.authorization = `Bearer ${process.env.SHIELD_API_KEY}`;
  const ip = h ? visitorIp(h) : undefined;
  if (process.env.SHIELD_RELAY_KEY && ip) { out["x-heimdall-relay"] = process.env.SHIELD_RELAY_KEY; out["x-heimdall-client-ip"] = ip; }
  return out;
}
