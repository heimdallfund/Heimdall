import { type Address, type PublicClient, type WalletClient, formatUnits, getAddress, parseAbi, parseAbiItem } from "viem";

/**
 * Daily jobs:
 *  - deposit snapshot for Guardian Points: every vault share holder's USDG value, posted to Shield;
 *  - fee distribution: HeimdallFeeSplitter.distribute(USDG), so $HEIM stakers' share starts streaming.
 */
const FACTORY = parseAbi(["function vaultCount() view returns (uint256)", "function allVaults(uint256) view returns (address)"]);
const VAULT = parseAbi(["function balanceOf(address) view returns (uint256)", "function convertToAssets(uint256) view returns (uint256)", "function decimals() view returns (uint8)"]);
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/** Current holders of each vault's shares (from Transfer logs) and their value in USDG. */
export async function depositSnapshot(client: PublicClient, factory: Address, fromBlock: bigint, window = 2_000_000n, holdersPerVault?: Map<string, number>): Promise<Record<string, number>> {
  const n = await client.readContract({ address: factory, abi: FACTORY, functionName: "vaultCount" });
  const latest = await client.getBlockNumber();
  const out: Record<string, number> = {};
  for (let i = 0n; i < n; i++) {
    const vault = await client.readContract({ address: factory, abi: FACTORY, functionName: "allVaults", args: [i] });
    const holders = new Set<Address>();
    for (let a = fromBlock; a <= latest; a += window) {
      const logs = await client.getLogs({ address: vault, event: TRANSFER, fromBlock: a, toBlock: a + window - 1n > latest ? latest : a + window - 1n });
      for (const l of logs) if (l.args.to && l.args.to !== "0x0000000000000000000000000000000000000000") holders.add(getAddress(l.args.to));
    }
    let count = 0;
    for (const h of holders) {
      const shares = await client.readContract({ address: vault, abi: VAULT, functionName: "balanceOf", args: [h] });
      if (shares === 0n) continue;
      const assets = await client.readContract({ address: vault, abi: VAULT, functionName: "convertToAssets", args: [shares] }).catch(() => 0n);
      out[h] = (out[h] ?? 0) + Number(formatUnits(assets, 6));
      count++;
    }
    holdersPerVault?.set(vault.toLowerCase(), count);
  }
  return out;
}

export async function postSnapshot(shieldUrl: string, adminKey: string, day: string, holdings: Record<string, number>, fetcher: typeof fetch = fetch) {
  const r = await fetcher(`${shieldUrl.replace(/\/$/, "")}/v1/points/deposits`, { method: "POST", headers: { "content-type": "application/json", "x-admin-key": adminKey }, body: JSON.stringify({ day, holdings }) });
  if (!r.ok) throw new Error(`points snapshot rejected (${r.status})`);
  return (await r.json()) as { awarded: number };
}

export async function distributeFees(wallet: WalletClient, client: PublicClient, splitter: Address, usdg: Address) {
  const bal = await client.readContract({ address: usdg, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [splitter] });
  if (bal === 0n) return null;
  const hash = await wallet.writeContract({ address: splitter, abi: parseAbi(["function distribute(address)"]), functionName: "distribute", args: [usdg], chain: wallet.chain, account: wallet.account! });
  await client.waitForTransactionReceipt({ hash });
  return { hash, amount: bal };
}

const AUTO = parseAbi([
  "function planCount() view returns (uint256)",
  "function isDue(uint256) view returns (bool)",
  "function execute(uint256) returns (uint256)",
  "function accruedFees() view returns (uint256)",
  "function sweepFees() returns (uint256)",
]);

/** Moves accrued Auto-Invest fees to its fee recipient (the splitter), so the daily distribution includes them. */
export async function sweepAutoInvestFees(wallet: WalletClient, client: PublicClient, autoInvest: Address) {
  const amount = await client.readContract({ address: autoInvest, abi: AUTO, functionName: "accruedFees" });
  if (amount === 0n) return null;
  const hash = await wallet.writeContract({ address: autoInvest, abi: AUTO, functionName: "sweepFees", chain: wallet.chain, account: wallet.account! });
  await client.waitForTransactionReceipt({ hash });
  return { hash, amount };
}

/** Keeper: executes every due Auto-Invest buy. A buy that would breach the user's price bound simply reverts in simulation and is skipped. */
export async function runAutoInvest(wallet: WalletClient, client: PublicClient, autoInvest: Address, from = 0n) {
  const n = await client.readContract({ address: autoInvest, abi: AUTO, functionName: "planCount" });
  const done: bigint[] = []; const skipped: { id: bigint; reason: string }[] = [];
  for (let id = from; id < n; id++) {
    if (!(await client.readContract({ address: autoInvest, abi: AUTO, functionName: "isDue", args: [id] }))) continue;
    try {
      const { request } = await client.simulateContract({ address: autoInvest, abi: AUTO, functionName: "execute", args: [id], account: wallet.account! });
      const hash = await wallet.writeContract(request as never);
      await client.waitForTransactionReceipt({ hash });
      done.push(id);
    } catch (e) {
      skipped.push({ id, reason: ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).split("\n")[0]! });
    }
  }
  return { done, skipped };
}

const VAULT_INFO = parseAbi([
  "function name() view returns (string)", "function manager() view returns (address)", "function decimals() view returns (uint8)",
  "function totalAssets() view returns (uint256)", "function convertToAssets(uint256) view returns (uint256)",
]);

/** Agent Arena: share price and TVL of every vault (vaults with a stale price are skipped for this round). */
export async function arenaRows(client: PublicClient, factory: Address, depositors: Map<string, number>) {
  const n = await client.readContract({ address: factory, abi: FACTORY, functionName: "vaultCount" });
  const rows: { vault: Address; name: string; manager: Address; pps: number; tvl: number; depositors?: number }[] = [];
  for (let i = 0n; i < n; i++) {
    const vault = await client.readContract({ address: factory, abi: FACTORY, functionName: "allVaults", args: [i] });
    try {
      const [name, manager, dec, tvl] = await Promise.all([
        client.readContract({ address: vault, abi: VAULT_INFO, functionName: "name" }),
        client.readContract({ address: vault, abi: VAULT_INFO, functionName: "manager" }),
        client.readContract({ address: vault, abi: VAULT_INFO, functionName: "decimals" }),
        client.readContract({ address: vault, abi: VAULT_INFO, functionName: "totalAssets" }),
      ]);
      const pps = await client.readContract({ address: vault, abi: VAULT_INFO, functionName: "convertToAssets", args: [10n ** BigInt(dec)] });
      rows.push({ vault, name, manager, pps: Number(formatUnits(pps, 6)), tvl: Number(formatUnits(tvl, 6)), depositors: depositors.get(vault.toLowerCase()) });
    } catch { /* stale price or unreadable vault: no point this round */ }
  }
  return rows;
}

export async function postArena(shieldUrl: string, adminKey: string, rows: unknown[], fetcher: typeof fetch = fetch) {
  const r = await fetcher(`${shieldUrl.replace(/\/$/, "")}/v1/arena/snapshots`, { method: "POST", headers: { "content-type": "application/json", "x-admin-key": adminKey }, body: JSON.stringify({ at: Date.now(), vaults: rows }) });
  if (!r.ok) throw new Error(`arena snapshot rejected (${r.status})`);
}

/** Robinhood stock tokens Heimdall prices (vaults, Auto-Invest). */
export const STOCK_TOKENS: Record<string, Address> = {
  NVDA: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", TSLA: "0x322f0929c4625ed5bad873c95208d54e1c003b2d", GOOGL: "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3",
  AAPL: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", MSFT: "0xe93237c50d904957cf27e7b1133b510c669c2e74", AMZN: "0x12f190a9f9d7d37a250758b26824b97ce941bf54",
};
const STOCK = parseAbi(["function oraclePaused() view returns (bool)", "function uiMultiplier() view returns (uint256)", "function newUIMultiplier() view returns (uint256)", "function effectiveAt() view returns (uint256)"]);

export interface CorporateAction { symbol: string; token: Address; paused: boolean; multiplier: number; next?: { multiplier: number; at: number } }

/** Stock tokens with an oracle pause or a multiplier change scheduled ahead (splits, dividends). Vault deposits,
 *  NAV withdrawals, trades and Auto-Invest buys on that stock stop while it is paused; in-kind exits keep working. */
export async function corporateActions(client: PublicClient, tokens = STOCK_TOKENS, now = Math.floor(Date.now() / 1000)): Promise<CorporateAction[]> {
  const out: CorporateAction[] = [];
  for (const [symbol, token] of Object.entries(tokens)) {
    const r = await Promise.all((["oraclePaused", "uiMultiplier", "newUIMultiplier", "effectiveAt"] as const).map((fn) =>
      client.readContract({ address: token, abi: STOCK, functionName: fn }).catch(() => undefined)));
    const [paused, mult, next, at] = r as [boolean | undefined, bigint | undefined, bigint | undefined, bigint | undefined];
    const scheduled = at !== undefined && Number(at) > now && next !== undefined && next > 0n;
    if (!paused && !scheduled) continue;
    out.push({ symbol, token, paused: paused === true, multiplier: Number(mult ?? 0n) / 1e18, ...(scheduled ? { next: { multiplier: Number(next) / 1e18, at: Number(at) } } : {}) });
  }
  return out;
}

export function formatCorporateAction(a: CorporateAction): string {
  const lines = [`🟣 ${a.symbol}: ${a.paused ? "oracle paused (corporate action)" : "corporate action scheduled"}`];
  if (a.next) lines.push(`Multiplier ${a.multiplier.toFixed(6)} → ${a.next.multiplier.toFixed(6)} at ${new Date(a.next.at * 1000).toISOString().replace(".000Z", " UTC").replace("T", " ")}`);
  lines.push(a.paused ? "Vault deposits, NAV withdrawals, trades and Auto-Invest buys on this stock wait until Robinhood unpauses. In-kind exits still work." : "Expect a short oracle pause around that time.");
  return lines.join("\n");
}

/** Wallet Watch: asks Shield to rescan watched wallets and push a notification for each new risky approval. */
/** Runs watch passes until the whole watch list was covered once (each pass scans at most `limit` wallets). */
export async function watchAll(shieldUrl: string, adminKey: string, limit = 200, fetcher: typeof fetch = fetch) {
  let scanned = 0, notified = 0, watched = Infinity;
  for (let i = 0; i < 100 && scanned < watched; i++) {
    const r = await fetcher(`${shieldUrl}/v1/admin/watch/run?limit=${limit}`, { method: "POST", headers: { "x-admin-key": adminKey }, signal: AbortSignal.timeout(280_000) });
    if (r.status === 503) return null;
    if (!r.ok) throw new Error(`watch run failed (${r.status})`);
    const j = (await r.json()) as { watched: number; scanned: number; notified: number };
    watched = j.watched; scanned += j.scanned; notified += j.notified;
    if (!j.scanned) break;
  }
  return { watched: watched === Infinity ? 0 : watched, scanned, notified };
}

/** Status page heartbeat: the monitor reports itself and whether Shield and the RPC answered this tick. */
export async function heartbeat(shieldUrl: string, adminKey: string, service: "monitor" | "keeper", client: PublicClient | null, detail?: string, fetcher: typeof fetch = fetch) {
  const probes: Record<string, boolean> = {};
  if (service === "monitor") {
    probes.shield = await fetcher(`${shieldUrl}/health`, { signal: AbortSignal.timeout(5_000) }).then((r) => r.ok).catch(() => false);
    probes.rpc = client ? await client.getBlock().then((b) => Date.now() / 1000 - Number(b.timestamp) < 300).catch(() => false) : false;
  }
  await fetcher(`${shieldUrl}/v1/admin/heartbeat`, { method: "POST", headers: { "content-type": "application/json", "x-admin-key": adminKey }, body: JSON.stringify({ service, probes, detail }), signal: AbortSignal.timeout(5_000) }).catch(() => {});
  return probes;
}
