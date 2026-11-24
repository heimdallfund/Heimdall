import { type Address, type Hex, type PublicClient, formatUnits, getAddress, pad, parseAbi, toEventSelector } from "viem";
import { blocklistEntries, isBlocklisted } from "./blocklist.js";
import { KNOWN_CONTRACTS } from "./chains.js";
import { KNOWN_SPENDERS, knownSpender, knownToken, PERMIT2, TOKENS } from "./registry.js";
import type { CounterStore } from "./store.js";

/**
 * Wallet Check: every live token approval of a wallet, with a risk level and the value it exposes.
 *
 * Discovery (all best-effort, merged):
 *  1. Approval / ApprovalForAll logs of the owner over the last ~29k blocks, any token (catches fresh approvals);
 *  2. full-history Approval logs on known tokens and on tokens the explorer says the wallet holds, plus Permit2
 *     Approval/Permit logs, scanned in windows the RPC accepts and resumed from the last scanned block;
 *  3. optional GoldRush approvals API (GOLDRUSH_API_KEY).
 * Every candidate is then re-read live (allowance, isApprovedForAll, Permit2.allowance); zeros are dropped.
 */

const APPROVAL = toEventSelector("Approval(address,address,uint256)");
const APPROVAL_ALL = toEventSelector("ApprovalForAll(address,address,bool)");
const P2_APPROVAL = toEventSelector("Approval(address,address,address,uint160,uint48)");
const P2_PERMIT = toEventSelector("Permit(address,address,address,uint160,uint48,uint48)");
const ERC20 = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function isApprovedForAll(address,address) view returns (bool)",
]);
const P2 = parseAbi(["function allowance(address,address,address) view returns (uint160,uint48,uint48)"]);
const FEED = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"]);
const UNLIMITED = 2n ** 255n;
const P2_UNLIMITED = 2n ** 159n;

export type Risk = "danger" | "review" | "ok";
export interface ApprovalRow {
  kind: "erc20" | "all" | "permit2";
  token: Address; symbol: string; decimals: number;
  spender: Address; spenderLabel: string | null; spenderIsContract: boolean;
  allowance: string; unlimited: boolean; expiresAt: number | null;
  balance: string; atRiskUsd: number | null;
  risk: Risk; reasons: string[];
}
export interface WalletReport {
  owner: Address; block: string; scannedAt: number;
  approvals: ApprovalRow[];
  summary: { total: number; danger: number; review: number; atRiskUsd: number };
  sources: string[];
  /** false when the history scan ran out of budget; the next scan continues where this one stopped. */
  complete: boolean;
  /** Share of the wallet's token history scanned so far, 0–100. */
  progress: number;
  /** Held tokens that are themselves a risk (set by the /v1/wallet route). */
  tokens?: import("./holdings.js").TokenFlag[];
  /** How many held tokens were looked at for {@link tokens}. */
  tokensChecked?: number;
}

interface Candidate { kind: ApprovalRow["kind"]; token: string; spender: string }
interface ScanState { scannedTo: string; candidates: Candidate[]; tokens: string[]; progress?: Record<string, string>; complete?: boolean; flags?: string; report?: Pick<WalletReport, "approvals" | "summary"> }

export interface ScanOptions {
  client: PublicClient;
  store?: CounterStore;
  fetcher?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Extra signal: addresses Shield denied recently (Threat Board). */
  deniedTargets?: Set<string>;
  now?: number;
  /** Wallet Watch: when no approval happened since the last complete scan and no spender's standing changed, reuse that report. */
  quick?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (c: Candidate) => `${c.kind}|${c.token.toLowerCase()}|${c.spender.toLowerCase()}`;
const topicAddr = (t: Hex) => getAddress(`0x${t.slice(26)}`);

/** Caps RPC work per scan; an unfinished scan is resumed on the next request. */
class Budget { constructor(public left: number) {} take() { if (--this.left < 0) throw new Error("scan_budget_exhausted"); } }
let budget = new Budget(Infinity);

async function getLogs(client: PublicClient, params: Record<string, unknown>): Promise<{ address: Address; topics: Hex[] }[]> {
  budget.take();
  for (let i = 0; ; i++) {
    try {
      return (await client.request({ method: "eth_getLogs", params: [params] } as never)) as { address: Address; topics: Hex[] }[];
    } catch (e) {
      const m = String((e as { details?: string }).details ?? (e as Error).message);
      if (/429|Too Many|rate/i.test(m) && i < 4) { await sleep(800 * (i + 1)); continue; }
      throw e;
    }
  }
}

/**
 * Windowed scan with an adaptive window: it halves after the RPC refuses a range (too many logs, too wide, timed out)
 * and keeps the smaller size for the next ranges, growing back once queries succeed. Busy history then costs a few
 * failed queries, not a few per window.
 */
async function scanRange(client: PublicClient, base: Record<string, unknown>, from: bigint, to: bigint, window: bigint, out: { address: Address; topics: Hex[] }[], onWindow?: (to: bigint) => void) {
  const hex = (n: bigint) => `0x${n.toString(16)}`;
  let size = window; let a = from; let wins = 0;
  while (a <= to) {
    const b = a + size - 1n > to ? to : a + size - 1n;
    try {
      out.push(...(await getLogs(client, { ...base, fromBlock: hex(a), toBlock: hex(b) })));
      onWindow?.(b);
      a = b + 1n;
      if (++wins >= 2 && size < window) { size = size * 2n > window ? window : size * 2n; wins = 0; }
    } catch (e) {
      const m = String((e as { details?: string }).details ?? (e as Error).message);
      if (/budget/.test(m)) throw e;
      // a rate limit is not a range problem: stop this job (progress is kept) instead of shrinking the window
      if (/429|too many requests|rate.?limit/i.test(m)) throw e;
      if (/exceeds|too many|limit|spans|timed? ?out|timeout/i.test(m) && b > a) { size = (b - a + 1n) / 2n || 1n; wins = 0; continue; }
      throw e;
    }
  }
}

async function explorerTokens(owner: Address, fetcher: typeof fetch, env: NodeJS.ProcessEnv): Promise<string[]> {
  const base = (env.EXPLORER_API_URL ?? "https://robinhoodchain.blockscout.com").replace(/\/$/, "");
  try {
    const r = await fetcher(`${base}/api/v2/addresses/${owner}/token-balances`, { signal: AbortSignal.timeout(6_000) });
    if (!r.ok) return [];
    const j = (await r.json()) as { token?: { address?: string; address_hash?: string; type?: string } }[];
    return j.filter((x) => (x.token?.type ?? "ERC-20") === "ERC-20").map((x) => (x.token?.address_hash ?? x.token?.address ?? "").toLowerCase()).filter(Boolean);
  } catch { return []; }
}

async function goldrush(owner: Address, fetcher: typeof fetch, env: NodeJS.ProcessEnv): Promise<Candidate[]> {
  if (!env.GOLDRUSH_API_KEY) return [];
  const chain = env.GOLDRUSH_CHAIN ?? "robinhood-mainnet";
  try {
    const r = await fetcher(`https://api.covalenthq.com/v1/${chain}/approvals/${owner}/`, { headers: { authorization: `Bearer ${env.GOLDRUSH_API_KEY}` }, signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: { items?: { token_address: string; spenders?: { spender_address: string }[] }[] } };
    return (j.data?.items ?? []).flatMap((t) => (t.spenders ?? []).map((s) => ({ kind: "erc20" as const, token: t.token_address.toLowerCase(), spender: s.spender_address.toLowerCase() })));
  } catch { return []; }
}

export async function scanWallet(ownerIn: Address, o: ScanOptions): Promise<WalletReport> {
  const owner = getAddress(ownerIn);
  const env = o.env ?? process.env;
  const fetcher = o.fetcher ?? fetch;
  const client = o.client;
  const latest = await client.getBlockNumber({ cacheTime: 0 }); // viem caches the head for 4 s; a scan right after an approval must see it
  const window = BigInt(env.LOG_WINDOW ?? 10_000_000); // the public RPC allows 10M blocks per query with one address
  const recentSpan = BigInt(env.RECENT_WINDOW ?? 29_000);
  let startBlock = BigInt(env.SCAN_FROM_BLOCK ?? 0);
  const ownerTopic = pad(owner.toLowerCase() as Hex);
  const sources: string[] = [];
  budget = new Budget(Number(env.SCAN_MAX_REQUESTS ?? 60));

  const stateKey = `wallet:${owner.toLowerCase()}`;
  // A wallet approves only after its first transaction: find that block with a binary search on the nonce
  // (needs an archive RPC; without one, or for a wallet that never sent a transaction, scan everything).
  const firstTx = async (): Promise<bigint | null> => {
    try {
      if ((await client.getTransactionCount({ address: owner, blockNumber: latest })) === 0) return null;
      let lo = startBlock, hi = latest;
      while (lo < hi) { const mid = (lo + hi) / 2n; if ((await client.getTransactionCount({ address: owner, blockNumber: mid })) > 0) hi = mid; else lo = mid + 1n; }
      return lo > 0n ? lo - 1n : 0n;
    } catch { return null; }
  };
  const prev = o.store ? (JSON.parse((await o.store.fetch(stateKey)) ?? "null") as ScanState | null) : null;
  if (!prev && env.SCAN_FIRST_TX !== "0") { const f = await firstTx(); if (f !== null && f > startBlock) { startBlock = f; sources.push("history from first transaction"); } }
  const cands = new Map<string, Candidate>((prev?.candidates ?? []).map((c) => [key(c), c]));
  const add = (c: Candidate) => cands.set(key(c), c);

  // 0. pairs worth checking on every scan: known tokens × known protocol spenders, the blocklist and Shield's denied targets
  const watch = new Set([...Object.keys(KNOWN_SPENDERS), ...blocklistEntries().map((b) => b.address.toLowerCase()), ...(o.deniedTargets ?? [])]);
  for (const t of Object.keys(TOKENS)) for (const sp of watch) add({ kind: "erc20", token: t, spender: sp });
  // which of the wallet's known spenders are blocklisted or denied right now; a change forces a full re-check
  const flagsOf = () => [...new Set([...cands.values()].map((c) => c.spender))].filter((sp) => isBlocklisted(sp) || o.deniedTargets?.has(sp)).sort().join(",");

  const addLog = (l: { address: Address; topics: Hex[] }) => {
    if (l.address.toLowerCase() === PERMIT2.toLowerCase()) { if (l.topics.length === 4) add({ kind: "permit2", token: topicAddr(l.topics[2]).toLowerCase(), spender: topicAddr(l.topics[3]).toLowerCase() }); }
    else if (l.topics[0] === APPROVAL_ALL) add({ kind: "all", token: l.address.toLowerCase(), spender: topicAddr(l.topics[2]).toLowerCase() });
    else if (l.topics[0] === APPROVAL && l.topics.length === 3) add({ kind: "erc20", token: l.address.toLowerCase(), spender: topicAddr(l.topics[2]).toLowerCase() });
  };

  // A wallet whose history is already complete only needs the blocks since then: one query over every contract,
  // filtered by the owner topic, instead of one query per token. Missed tip blocks are covered next time.
  // Public RPCs cap queries without an address at ~30k blocks (TAIL_WINDOW), so the per-token route can be cheaper
  // after a long gap: pick whichever needs fewer requests.
  const tailWindow = BigInt(env.TAIL_WINDOW ?? env.RECENT_WINDOW ?? 29_000);
  const gap = prev ? latest - BigInt(prev.scannedTo) : 0n;
  const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;
  const perTokenCost = BigInt((prev?.tokens.length ?? 0) + 1) * ceil(gap, window);
  const incremental = !!prev?.complete && gap > 0n && env.SCAN_INCREMENTAL !== "0" && ceil(gap, tailWindow) <= perTokenCost;
  let tailOk = true;
  const recent: { address: Address; topics: Hex[] }[] = [];
  if (incremental) {
    await scanRange(client, { topics: [[APPROVAL, APPROVAL_ALL, P2_APPROVAL, P2_PERMIT], ownerTopic] }, BigInt(prev!.scannedTo) + 1n, latest, tailWindow, recent).catch(() => { tailOk = false; });
    for (const l of recent) addLog(l);
    sources.push("new blocks since last scan");
    if (o.quick && tailOk && recent.length === 0 && prev!.report && flagsOf() === prev!.flags) {
      const done = latest > 20n ? latest - 20n : latest;
      if (o.store) await o.store.put(stateKey, JSON.stringify({ ...prev!, scannedTo: done.toString() }), 30 * 86_400).catch(() => {});
      return { owner, block: latest.toString(), scannedAt: Date.now(), ...prev!.report, sources: [...sources, "no change since last scan"], complete: true, progress: 100 };
    }
  } else {
    // 1. recent approvals of any token
    let recentFrom = latest > recentSpan ? latest - recentSpan : 0n;
    if (recentFrom < startBlock) recentFrom = startBlock;
    // a failed recent window must not pass for a clean wallet: the scan stays incomplete and is retried
    await scanRange(client, { topics: [[APPROVAL, APPROVAL_ALL], ownerTopic] }, recentFrom, latest, recentSpan + 1n, recent).catch(() => { tailOk = false; });
    for (const l of recent) addLog(l);
    sources.push("recent approvals");
  }

  // 2. full history on known + held tokens, resumed from the last scan
  const held = await explorerTokens(owner, fetcher, env);
  if (held.length) sources.push("explorer token list");
  // Known tokens get a full history only while the wallet holds them; for the rest, step 0 still checks every known
  // protocol, blocklisted and Shield-denied spender directly, and an approval on a token you hold none of puts nothing at risk.
  const known = Object.keys(TOKENS);
  const knownBals = await (client.multicall({ contracts: known.map((t) => ({ address: t as Address, abi: ERC20, functionName: "balanceOf", args: [owner] })) as never, allowFailure: true }) as Promise<{ status: string; result?: bigint }[]>).catch(() => null);
  const heldKnown = known.filter((t, i) => !knownBals || knownBals[i]?.status !== "success" || (knownBals[i].result ?? 0n) > 0n);
  const tokenSet = new Set([...heldKnown, ...held, ...(prev?.tokens ?? []), ...recent.map((l) => l.address.toLowerCase())]);
  const newTokens = [...tokenSet].filter((t) => !(prev?.tokens ?? []).includes(t));
  const resumeFrom = prev ? BigInt(prev.scannedTo) + 1n : startBlock;
  const progress: Record<string, string> = { ...(prev?.progress ?? {}) };
  const fromFor = (a: string) => progress[a.toLowerCase()] !== undefined ? BigInt(progress[a.toLowerCase()]!) + 1n : newTokens.includes(a) ? startBlock : resumeFrom;
  const jobs: { address: string; from: bigint; topics: unknown[] }[] = incremental
    // only tokens the wallet did not hold before need their full history
    ? newTokens.map((t) => ({ address: t, from: startBlock, topics: [APPROVAL, ownerTopic] }))
    : [
      { address: PERMIT2, from: fromFor(PERMIT2), topics: [[P2_APPROVAL, P2_PERMIT], ownerTopic] },
      ...[...tokenSet].map((t) => ({ address: t, from: fromFor(t), topics: [APPROVAL, ownerTopic] })),
    ];
  let complete = tailOk;
  if (env.SCAN_DEBUG) console.error("scan", owner, { latest: String(latest), startBlock: String(startBlock), incremental, recent: recent.length, jobs: jobs.length, tailOk });
  const conc = Number(env.SCAN_CONCURRENCY ?? 4);
  for (let i = 0; i < jobs.length; i += conc) {
    await Promise.all(jobs.slice(i, i + conc).map(async (j) => {
      if (j.from > latest) return;
      const logs: { address: Address; topics: Hex[] }[] = [];
      // history stops a few blocks behind the head (load-balanced nodes lag); the recent window covers the tip
      const head = latest > 20n ? latest - 20n : latest;
      const collect = () => { for (const l of logs.splice(0)) {
        if (l.address.toLowerCase() === PERMIT2.toLowerCase()) add({ kind: "permit2", token: topicAddr(l.topics[2]).toLowerCase(), spender: topicAddr(l.topics[3]).toLowerCase() });
        else if (l.topics.length === 3) add({ kind: "erc20", token: l.address.toLowerCase(), spender: topicAddr(l.topics[2]).toLowerCase() });
      } };
      try { await scanRange(client, { address: j.address, topics: j.topics }, j.from, head, window, logs, (b) => { collect(); progress[j.address.toLowerCase()] = b.toString(); }); }
      catch (e) { complete = false; if (env.SCAN_DEBUG) console.error("scan error", j.address, String((e as { details?: string }).details ?? (e as Error).message).slice(0, 160)); }
    }));
  }
  sources.push("token history");
  for (const c of await goldrush(owner, fetcher, env)) { add(c); if (!sources.includes("GoldRush")) sources.push("GoldRush"); }

  // 3. live state
  const list = [...cands.values()];
  const tokens = [...new Set(list.map((c) => c.token))] as Address[];
  const mc = <T,>(contracts: unknown[]) => client.multicall({ contracts: contracts as never, allowFailure: true }) as Promise<{ status: string; result?: T }[]>;
  const [live, meta, bals] = await Promise.all([
    mc<unknown>(list.map((c) => c.kind === "erc20" ? { address: c.token, abi: ERC20, functionName: "allowance", args: [owner, c.spender] }
      : c.kind === "all" ? { address: c.token, abi: ERC20, functionName: "isApprovedForAll", args: [owner, c.spender] }
      : { address: PERMIT2, abi: P2, functionName: "allowance", args: [owner, c.token, c.spender] })),
    mc<unknown>(tokens.flatMap((t) => [{ address: t, abi: ERC20, functionName: "symbol" }, { address: t, abi: ERC20, functionName: "decimals" }])),
    mc<bigint>(tokens.map((t) => ({ address: t, abi: ERC20, functionName: "balanceOf", args: [owner] }))),
  ]);
  const feeds = tokens.filter((t) => knownToken(t)?.feed);
  const prices = await mc<readonly [bigint, bigint, bigint, bigint, bigint]>(feeds.map((t) => ({ address: knownToken(t)!.feed!, abi: FEED, functionName: "latestRoundData" })));
  const priceOf = new Map<string, number>();
  feeds.forEach((t, i) => { const r = prices[i]; if (r.status === "success" && r.result![1] > 0n) priceOf.set(t, Number(r.result![1]) / 1e8); });
  for (const t of tokens) if (knownToken(t)?.stable) priceOf.set(t, 1);
  const tokInfo = new Map(tokens.map((t, i) => {
    const k = knownToken(t);
    const sym = meta[i * 2]?.status === "success" ? String(meta[i * 2].result) : k?.symbol ?? "UNKNOWN";
    const dec = meta[i * 2 + 1]?.status === "success" ? Number(meta[i * 2 + 1].result) : k?.decimals ?? 18;
    const bal = bals[i]?.status === "success" ? (bals[i].result as bigint) : 0n;
    return [t, { sym, dec, bal }];
  }));

  const spenders = [...new Set(list.map((c) => c.spender))];
  const codes = new Map<string, boolean>();
  for (let i = 0; i < spenders.length; i += 8) {
    await Promise.all(spenders.slice(i, i + 8).map(async (s) => {
      const code = await client.getCode({ address: s as Address }).catch(() => undefined);
      codes.set(s, !!code && code !== "0x" && !code.toLowerCase().startsWith("0xef0100"));
    }));
  }

  const now = Math.floor((o.now ?? Date.now()) / 1000);
  const rows: ApprovalRow[] = [];
  list.forEach((c, i) => {
    const r = live[i];
    if (r?.status !== "success") return;
    let amount = 0n; let expiresAt: number | null = null;
    if (c.kind === "erc20") amount = r.result as bigint;
    else if (c.kind === "all") amount = r.result ? UNLIMITED : 0n;
    else { const [a, exp] = r.result as readonly [bigint, number, number]; amount = a; expiresAt = Number(exp); if (expiresAt && expiresAt < now) amount = 0n; }
    if (amount === 0n) return;
    const info = tokInfo.get(c.token as Address) ?? { sym: "UNKNOWN", dec: 18, bal: 0n };
    const unlimited = c.kind === "permit2" ? amount >= P2_UNLIMITED : amount >= UNLIMITED;
    const label = knownSpender(c.spender) ?? KNOWN_CONTRACTS[4663]?.[c.spender]?.name ?? null;
    const isContract = codes.get(c.spender) ?? false;
    const reasons: string[] = []; let risk: Risk = "ok";
    if (isBlocklisted(c.spender)) { risk = "danger"; reasons.push("Spender is on the Heimdall blocklist of known drainers."); }
    if (!isContract && !label) { risk = "danger"; reasons.push("Spender is a plain wallet, not a contract: the classic drainer pattern."); }
    if (o.deniedTargets?.has(c.spender)) { risk = "danger"; reasons.push("Shield recently denied transactions to this address."); }
    if (risk !== "danger" && !label) {
      if (unlimited || c.kind === "all") { risk = "review"; reasons.push(`${c.kind === "all" ? "Controls every token of this collection" : "Unlimited allowance"} to a contract Heimdall does not recognise.`); }
      else reasons.push("Limited allowance to a contract Heimdall does not recognise.");
    }
    if (label && risk === "ok") reasons.push("Known protocol contract.");
    if (c.kind === "permit2" && risk === "ok" && expiresAt) reasons.push(`Expires ${new Date(expiresAt * 1000).toISOString().slice(0, 10)}.`);
    const exposed = c.kind === "all" || amount > info.bal ? info.bal : amount;
    const px = priceOf.get(c.token);
    rows.push({
      kind: c.kind, token: getAddress(c.token), symbol: info.sym, decimals: info.dec,
      spender: getAddress(c.spender), spenderLabel: label, spenderIsContract: isContract,
      allowance: unlimited ? "unlimited" : formatUnits(amount, info.dec), unlimited, expiresAt,
      balance: formatUnits(info.bal, info.dec),
      atRiskUsd: px === undefined ? null : Math.round(Number(formatUnits(exposed, info.dec)) * px * 100) / 100,
      risk, reasons,
    });
  });
  const order: Record<Risk, number> = { danger: 0, review: 1, ok: 2 };
  rows.sort((a, b) => order[a.risk] - order[b.risk] || (b.atRiskUsd ?? 0) - (a.atRiskUsd ?? 0));
  const atRisk = rows.filter((r) => r.risk !== "ok").reduce((s, r) => s + (r.atRiskUsd ?? 0), 0);
  const reportSummary = { total: rows.length, danger: rows.filter((r) => r.risk === "danger").length, review: rows.filter((r) => r.risk === "review").length, atRiskUsd: Math.round(atRisk * 100) / 100 };

  if (o.store) {
    const keep = list.filter((c) => !(watch.has(c.spender) && TOKENS[c.token]) || rows.some((r) => r.token.toLowerCase() === c.token && r.spender.toLowerCase() === c.spender));
    // stop 20 blocks short of the head: a lagging node may not have their logs yet, and the next scan re-reads them
    const done = latest > 20n ? latest - 20n : latest;
    const next: ScanState = complete
      ? { scannedTo: done.toString(), candidates: keep, tokens: [...tokenSet], progress, complete: true, flags: flagsOf(), report: { approvals: rows, summary: reportSummary } }
      : incremental
        // keep the old mark and token list so the next scan retries the same new blocks and new tokens
        ? { ...prev!, candidates: keep }
        : { scannedTo: BigInt(prev?.scannedTo ?? startBlock - 1n).toString(), candidates: keep, tokens: [...tokenSet], progress, complete: false };
    await o.store.put(stateKey, JSON.stringify(next), 30 * 86_400).catch(() => {});
  }
  const head = latest > 20n ? latest - 20n : latest;
  const span = Number(head - startBlock) || 1;
  const pct = complete ? 1 : jobs.reduce((acc, j) => acc + Math.min(1, Math.max(0, Number(BigInt(progress[j.address.toLowerCase()] ?? (j.from - 1n).toString()) - startBlock) / span)), 0) / jobs.length;
  return {
    owner, block: latest.toString(), scannedAt: Date.now(), approvals: rows,
    summary: reportSummary,
    sources,
    complete,
    progress: Math.round(pct * 100),
  };
}
