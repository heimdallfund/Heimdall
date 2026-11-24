import { type Address, type PublicClient, formatUnits, getAddress } from "viem";
import { isBlocklisted } from "./blocklist.js";
import { fakeTokenCheck } from "./impersonation.js";
import { TOKENS } from "./registry.js";
import type { TokenCheck } from "./tokencheck.js";

/** A token the wallet holds that is itself the risk: fake, blocklisted, or a trap that cannot be sold or can be pulled back. */
export interface TokenFlag {
  token: Address;
  symbol: string;
  balance: string;
  risk: "danger" | "review";
  code: string;
  reason: string;
}

export interface Holding { token: Address; symbol: string; name: string | null; decimals: number; value: bigint }

/** Token balances from the explorer (Blockscout v2). Empty on any failure: the approval scan does not depend on it. */
export async function explorerHoldings(owner: Address, fetcher: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<Holding[]> {
  const base = (env.EXPLORER_API_URL ?? "https://robinhoodchain.blockscout.com").replace(/\/$/, "");
  try {
    const r = await fetcher(`${base}/api/v2/addresses/${owner}/token-balances`, { signal: AbortSignal.timeout(6_000), headers: { accept: "application/json", "user-agent": "heimdall-shield/1 (+https://heimdall.fund)" } });
    if (!r.ok) { console.warn(JSON.stringify({ level: "warn", msg: "explorer holdings", status: r.status })); return []; }
    const j = (await r.json()) as { value?: string; token?: { address?: string; address_hash?: string; type?: string; symbol?: string | null; name?: string | null; decimals?: string | null } }[];
    if (!Array.isArray(j)) return [];
    return j.flatMap((x) => {
      const a = x.token?.address_hash ?? x.token?.address;
      if ((x.token?.type ?? "ERC-20") !== "ERC-20" || !a) return [];
      let value = 0n;
      try { value = BigInt(x.value ?? "0"); } catch { /* malformed */ }
      if (value === 0n) return [];
      return [{ token: getAddress(a), symbol: x.token?.symbol ?? "UNKNOWN", name: x.token?.name ?? null, decimals: Number(x.token?.decimals ?? 18) || 0, value }];
    });
  } catch (e) { console.warn(JSON.stringify({ level: "warn", msg: "explorer holdings", error: (e as Error).message })); return []; }
}

/** Token Check findings that are worth a warning on a wallet page. Missing pools and owners are normal for small tokens. */
const QUIET = new Set(["NO_POOL", "HAS_OWNER", "SIM_UNAVAILABLE", "KNOWN_TOKEN", "BUY_FAILS"]);

export interface FlagOptions {
  /** Full Token Check for an unknown token; null when it could not run. */
  check?: (token: Address) => Promise<TokenCheck | null>;
  /** How many unknown tokens get a full Token Check (the rest still get the blocklist and fake-ticker checks). */
  deepLimit?: number;
  /** Per-token budget for the full check, in ms. */
  timeoutMs?: number;
}

const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

export async function flagHoldings(client: PublicClient, holdings: Holding[], o: FlagOptions = {}): Promise<TokenFlag[]> {
  const unknown = holdings.filter((h) => !TOKENS[h.token.toLowerCase()]).slice(0, 50);
  const deepLimit = o.deepLimit ?? 5;
  let deep = 0;
  const flags = await Promise.all(unknown.map(async (h): Promise<TokenFlag | null> => {
    const base = { token: h.token, symbol: h.symbol, balance: formatUnits(h.value, h.decimals) };
    if (isBlocklisted(h.token)) return { ...base, risk: "danger", code: "BLOCKLISTED_TOKEN", reason: "This token is on the Heimdall blocklist. Do not trade it or approve anything for it." };
    const fake = await fakeTokenCheck(client, h.token).catch(() => undefined);
    if (fake) return { ...base, risk: "danger", code: "FAKE_TOKEN", reason: `Pretends to be ${fake.symbol}, but it is not the real ${fake.symbol} contract (${fake.real}). Often airdropped to bait a swap or a poisoned transfer.` };
    if (!o.check || deep >= deepLimit) return null;
    deep++;
    const r = await within(o.check(h.token).catch(() => null), o.timeoutMs ?? 8_000);
    if (!r) return null;
    const hit = r.findings.find((f) => f.severity === "deny") ?? r.findings.find((f) => f.severity === "warn" && !QUIET.has(f.code));
    if (!hit) return null;
    return { ...base, risk: hit.severity === "deny" ? "danger" : "review", code: hit.code, reason: hit.message };
  }));
  const order = { danger: 0, review: 1 } as const;
  return flags.filter((f): f is TokenFlag => !!f).sort((a, b) => order[a.risk] - order[b.risk]);
}
