import {
  type Address, type Hex, type PublicClient, type WalletClient,
  encodeFunctionData, parseAbi, keccak256, toHex,
} from "viem";
import {
  HeimdallShield, HeimdallDenied, heimdallVaultAbi, receiptArgs, signVoucher, encodeVoucherHeader,
  type ShieldReceipt,
} from "@heimdall/sdk";
import { plan, type Holding, type Order, type Signals } from "./strategy.js";
import type { RouterAdapter } from "./router.js";

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function approve(address,uint256) returns (bool)",
]);

/** Where trade approvals come from. Production: the Shield API. */
export interface ReceiptProvider {
  receipt(vault: Address, target: Address, data: Hex): Promise<ShieldReceipt>;
}

export function shieldProvider(shield: HeimdallShield, chainId: number, policy?: Parameters<HeimdallShield["check"]>[1]): ReceiptProvider {
  return {
    async receipt(vault, target, data) {
      const r = await shield.check({ chainId, from: vault, to: target, data, value: 0n }, policy);
      if (r.verdict !== "ALLOW" || !r.receipt) throw new HeimdallDenied(r);
      return r.receipt;
    },
  };
}

export interface SignalSource {
  /** Pays per call with a voucher and returns parsed JSON, or null when the signal is unavailable. */
  call<T>(path: string, signalId: bigint, price: bigint): Promise<T | null>;
}

/** Pays signals with cumulative vouchers; `spent` must be persisted between runs (see index.ts). */
export function voucherSignals(opts: { baseUrl: string; wallet: WalletClient; chainId: number; signals: Address; spent: Map<string, bigint>; fetchImpl?: typeof fetch; log?: (s: string) => void }): SignalSource {
  const f = opts.fetchImpl ?? fetch;
  return {
    async call<T>(path: string, signalId: bigint, price: bigint) {
      const key = signalId.toString();
      const cumulative = (opts.spent.get(key) ?? 0n) + price;
      const v = await signVoucher(opts.wallet, { chainId: opts.chainId, signals: opts.signals, signalId, cumulativeAmount: cumulative });
      const res = await f(`${opts.baseUrl}${path}`, { headers: { "x-heimdall-voucher": encodeVoucherHeader(v) } }).catch(() => null);
      if (!res || !res.ok) { opts.log?.(`signal ${path} unavailable (${res?.status ?? "network"})`); return null; }
      opts.spent.set(key, cumulative);
      return (await res.json()) as T;
    },
  };
}

export interface AgentConfig {
  vault: Address;
  usdg: Address;
  router: RouterAdapter;
  targetsBps: Record<string, number>;
  bandBps: number;
  slippageBps: number;
  signalIds?: { tokenRisk?: bigint; stockPremium?: bigint };
  signalPrices?: { tokenRisk: bigint; stockPremium: bigint };
  symbols?: Record<string, string>; // token → exchange symbol for stock premium
}

export interface RunReport { nav: bigint; orders: Order[]; executed: { order: Order; hash: Hex; checkId: Hex }[]; skipped: { order: Order; reason: string }[]; notes: string[] }

export async function readHoldings(client: PublicClient, vault: Address): Promise<{ holdings: Holding[]; usdgBalance: bigint; maxTradeBps: number; usdg: Address }> {
  const [tracked, usdg, maxTradeBps] = await Promise.all([
    client.readContract({ address: vault, abi: heimdallVaultAbi, functionName: "trackedAssets" }) as Promise<Address[]>,
    client.readContract({ address: vault, abi: heimdallVaultAbi, functionName: "asset" }) as Promise<Address>,
    client.readContract({ address: vault, abi: heimdallVaultAbi, functionName: "maxTradeBps" }) as Promise<number>,
  ]);
  const usdgBalance = await client.readContract({ address: usdg, abi: ERC20, functionName: "balanceOf", args: [vault] });
  const holdings: Holding[] = [];
  for (const token of tracked) {
    const [symbol, decimals, amount] = await Promise.all([
      client.readContract({ address: token, abi: ERC20, functionName: "symbol" }),
      client.readContract({ address: token, abi: ERC20, functionName: "decimals" }),
      client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [vault] }),
    ]);
    const one = 10n ** BigInt(decimals);
    const [value, price] = await Promise.all([
      client.readContract({ address: vault, abi: heimdallVaultAbi, functionName: "valueOf", args: [token, amount] }) as Promise<bigint>,
      client.readContract({ address: vault, abi: heimdallVaultAbi, functionName: "valueOf", args: [token, one] }) as Promise<bigint>,
    ]);
    holdings.push({ token, symbol, decimals, amount, value, price });
  }
  return { holdings, usdgBalance, maxTradeBps, usdg };
}

/** One decision cycle: read → buy signals → plan → for each order: Shield receipt → vault.execute. */
export async function runOnce(deps: {
  client: PublicClient; manager: WalletClient; receipts: ReceiptProvider; signals?: SignalSource; dryRun?: boolean; log?: (s: string) => void;
}, cfg: AgentConfig): Promise<RunReport> {
  const log = deps.log ?? (() => {});
  const { holdings, usdgBalance, maxTradeBps } = await readHoldings(deps.client, cfg.vault);
  const notes: string[] = [];

  // signals
  const sig: Signals = { risk: {}, premiumBps: {} };
  if (deps.signals && cfg.signalIds && cfg.signalPrices) {
    for (const h of holdings) {
      const k = h.token.toLowerCase();
      if (cfg.signalIds.tokenRisk !== undefined) {
        const r = await deps.signals.call<{ level: "low" | "medium" | "high" | "critical" }>(`/v1/token-risk?token=${h.token}`, cfg.signalIds.tokenRisk, cfg.signalPrices.tokenRisk);
        if (r) sig.risk![k] = r.level;
      }
      const sym = cfg.symbols?.[k];
      if (sym && cfg.signalIds.stockPremium !== undefined) {
        const p = await deps.signals.call<{ premiumBps: number }>(`/v1/stock-premium?symbol=${sym}`, cfg.signalIds.stockPremium, cfg.signalPrices.stockPremium);
        if (p) sig.premiumBps![k] = p.premiumBps;
      }
    }
  }

  const orders = plan({ usdg: cfg.usdg, usdgBalance, holdings, targetsBps: cfg.targetsBps, bandBps: cfg.bandBps, maxTradeBps, slippageBps: cfg.slippageBps, signals: sig });
  const total = usdgBalance + holdings.reduce((a, h) => a + h.value, 0n);
  log(`NAV ${Number(total) / 1e6} USDG · ${orders.length} order(s)`);
  const report: RunReport = { nav: total, orders, executed: [], skipped: [], notes };
  if (deps.dryRun) {
    for (const o of orders) log(`[dry-run] ${o.side} ${o.symbol}: in ${o.amountIn} → min out ${o.minOut} (${o.reason})`);
    return report;
  }

  const account = deps.manager.account!;
  const exec = async (target: Address, data: Hex) => {
    const r = await deps.receipts.receipt(cfg.vault, target, data);
    const { receipt, signature } = receiptArgs(r);
    const hash = await deps.manager.writeContract({ account, chain: deps.manager.chain, address: cfg.vault, abi: heimdallVaultAbi, functionName: "execute", args: [target, data, receipt, signature] });
    await deps.client.waitForTransactionReceipt({ hash });
    return { hash, checkId: r.message.checkId };
  };

  for (const o of orders) {
    try {
      const allowance = await deps.client.readContract({ address: o.tokenIn, abi: ERC20, functionName: "allowance", args: [cfg.vault, cfg.router.address] });
      if (allowance < o.amountIn) {
        await exec(o.tokenIn, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [cfg.router.address, o.amountIn] }));
      }
      const res = await exec(cfg.router.address, cfg.router.swapCalldata({ tokenIn: o.tokenIn, tokenOut: o.tokenOut, amountIn: o.amountIn, minOut: o.minOut, recipient: cfg.vault }));
      report.executed.push({ order: o, ...res });
      log(`${o.side} ${o.symbol} ✓ ${res.hash} (${o.reason})`);
    } catch (e) {
      const reason = e instanceof HeimdallDenied ? `Shield ${e.result.verdict}: ${e.message}` : (e as Error).message.split("\n")[0]!;
      report.skipped.push({ order: o, reason });
      log(`${o.side} ${o.symbol} ✗ ${reason}`);
    }
  }
  return report;
}

/** Test-only receipt provider: signs ALLOW receipts with a local key, without simulation. Never use in production. */
export function unsafeLocalReceipts(signer: { address: Address; signTypedData: (d: any) => Promise<Hex> }, chainId: number): ReceiptProvider {
  let n = 0;
  return {
    async receipt(vault, target, data) {
      const expiresAt = Math.floor(Date.now() / 1000) + 600;
      const message = { agent: vault, target, dataHash: keccak256(data), value: 0n, verdict: 0, expiresAt: BigInt(expiresAt), checkId: keccak256(toHex(`local-${Date.now()}-${++n}`)) };
      const signature = await signer.signTypedData({
        domain: { name: "Heimdall Shield", version: "1", chainId },
        types: { Receipt: [{ name: "agent", type: "address" }, { name: "target", type: "address" }, { name: "dataHash", type: "bytes32" }, { name: "value", type: "uint256" }, { name: "verdict", type: "uint8" }, { name: "expiresAt", type: "uint64" }, { name: "checkId", type: "bytes32" }] },
        primaryType: "Receipt", message,
      });
      return { signer: signer.address, signature, expiresAt, message: { ...message, value: "0", expiresAt: String(expiresAt) } };
    },
  };
}
