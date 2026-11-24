import {
  type Address, type Hex, type PublicClient, type WalletClient, type Chain,
  defineChain, keccak256, recoverTypedDataAddress, getAddress,
} from "viem";
import { heimdallSignalsAbi, heimdallVaultAbi, heimdallVaultFactoryAbi } from "./abi.js";

export { heimdallSignalsAbi, heimdallVaultAbi, heimdallVaultFactoryAbi };
export { heimdallPayAbi, heimdallStakingAbi, heimdallFeeSplitterAbi, heimdallAutoInvestAbi } from "./abi.js";
export { HeimdallAutoInvest, type Plan } from "./invest.js";
export { HeimdallPay, hashOf, JOB_STATUS, type Job, type JobStatus, type CreateJobInput } from "./pay.js";
export { verifyWebhook, parseWebhook, type WebhookEvent, type WebhookEventType } from "./webhooks.js";
export { heimdallRiskOracleAbi, heimdallGuardModuleAbi } from "./abi.js";
export { payX402, readPaymentRequired, X402_ROBINHOOD_USDG, X402Error, type PayX402Options, type X402Asset } from "./x402.js";
export { ERC8004_REGISTRIES, heimdallScore, executeThroughGuard, guardRemaining, guardSetupCalls, readRisk, RISK_FLAGS, RISK_LEVEL, safeBatch, type GuardSetup, type OnchainRisk, type SafeCall } from "./guard.js";
export { HEIMDALL_MAINNET } from "./deployments.js";

// ───────────────────────────── Chains ─────────────────────────────

export const robinhoodChain: Chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

export const robinhoodChainTestnet: Chain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" } },
  testnet: true,
});

export const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

// ───────────────────────────── Shield ─────────────────────────────

export type Verdict = "ALLOW" | "WARN" | "DENY";

export interface Policy {
  strict?: boolean;
  allowTargets?: Address[];
  denyTargets?: Address[];
  maxNativeOut?: string;
  maxTokenOut?: Record<string, string>;
  trustedSpenders?: Address[];
  denyUnlimitedApprovals?: boolean;
  allowContractDeploy?: boolean;
  trustedRecipients?: Address[];
  /** EIP-7702 delegate contracts the agent may authorise beyond the wallet implementations Heimdall knows. */
  trustedDelegates?: Address[];
}

/** EIP-7702 authorization tuple (the part that is signed, without the signature). */
export interface Authorization7702 { chainId: number | string; address: Address; nonce?: number | string }

export interface TxRequest {
  chainId?: number;
  from: Address;
  to?: Address | null;
  data?: Hex;
  value?: bigint | string | number;
  /** Type 4 (EIP-7702) transactions: the authorizations it carries. */
  authorizationList?: Authorization7702[];
}

export interface Finding { code: string; severity: "info" | "warn" | "deny"; message: string }

export interface ShieldReceipt {
  signer: Address;
  signature: Hex;
  expiresAt: number;
  message: {
    agent: Address; target: Address; dataHash: Hex; value: string;
    verdict: number; expiresAt: string; checkId: Hex;
  };
}

export interface CheckResult {
  checkId: Hex;
  verdict: Verdict;
  riskScore: number;
  summary: string[];
  findings: Finding[];
  decoded?: { functionName: string; signature: string; args: unknown[] };
  approvals: unknown[];
  assetChanges: { asset: Address; symbol: string; decimals: number; kind: string; delta: string; counterparties: Address[] }[];
  simulation: { ok: boolean; available: boolean; gasUsed?: string; revertReason?: string };
  receipt?: ShieldReceipt;
}

export interface SignatureRequest {
  chainId?: number;
  signer: Address;
  typedData?: { domain?: Record<string, unknown>; types?: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> };
  message?: string;
  /** An EIP-7702 authorization the wallet is asked to sign. */
  authorization?: Authorization7702;
}
export interface SignatureCheckResult {
  verdict: Verdict; riskScore: number; summary: string[]; findings: Finding[];
  approvals?: { token?: Address; spender: Address; amount?: string; unlimited?: boolean }[];
  shareId?: Hex;
}
export interface SharedVerdict { kind: "tx" | "sig"; at: number; chainId: number; result: CheckResult | SignatureCheckResult; [k: string]: unknown }
export interface ThreatBoard {
  window: string;
  codes: { code: string; count: number }[];
  targets: { address: Address; denies: number; blocklisted: boolean }[];
  recent: { at: number; kind: "tx" | "sig"; target: Address | null; codes: string[]; summary: string }[];
  blocklist: { address: Address; label?: string; reason?: string }[];
}
export interface AgentStats { address: Address; checks: number; allowed: number; warned: number; denied: number; firstSeen: number | null; lastSeen: number | null }

export interface WalletApproval {
  kind: "erc20" | "all" | "permit2"; token: Address; symbol: string; decimals: number;
  spender: Address; spenderLabel: string | null; spenderIsContract: boolean;
  allowance: string; unlimited: boolean; expiresAt: number | null; balance: string; atRiskUsd: number | null;
  risk: "danger" | "review" | "ok"; reasons: string[];
}
export interface WalletReport {
  owner: Address; block: string; scannedAt: number; approvals: WalletApproval[];
  summary: { total: number; danger: number; review: number; atRiskUsd: number };
  sources: string[]; complete: boolean; progress: number;
  /** Tokens the wallet holds that are themselves a risk: fakes, blocklisted tokens, honeypots, clawbacks. */
  tokens?: WalletTokenFlag[];
  tokensChecked?: number;
}
export interface WalletTokenFlag {
  token: Address; symbol: string; balance: string;
  risk: "danger" | "review"; code: string; reason: string;
}
export interface PointsSummary {
  address: Address; total: number; rank: number | null;
  breakdown: { revoke: number; report: number; deposit: number; checks: number };
  log: { at: number; reason: string; points: number; ref?: string }[];
}

export class HeimdallError extends Error {
  constructor(message: string, public readonly status?: number, public readonly body?: unknown) {
    super(message);
    this.name = "HeimdallError";
  }
}

/** Thrown by guardedSend when Shield does not answer ALLOW. */
export class HeimdallDenied extends Error {
  constructor(public readonly result: CheckResult) {
    super(`Heimdall Shield ${result.verdict}: ${result.findings.find((f) => f.severity !== "info")?.message ?? "blocked"}`);
    this.name = "HeimdallDenied";
  }
}

export interface ShieldOptions {
  baseUrl?: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

export class HeimdallShield {
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ShieldOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://api.heimdall.fund").replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });
    const body = await res.json().catch(() => undefined);
    if (!res.ok) throw new HeimdallError(`Shield request failed (${res.status})`, res.status, body);
    return body as T;
  }

  /** Simulate and judge a transaction before signing it. With `share`, the verdict is saved and `shareId` returned. */
  check(tx: TxRequest, policy?: Policy, opts: { share?: boolean; probe?: boolean } = {}): Promise<CheckResult & { shareId?: Hex }> {
    return this.request<CheckResult & { shareId?: Hex }>("/v1/check", {
      method: "POST",
      body: JSON.stringify({
        chainId: tx.chainId ?? 4663,
        from: tx.from,
        to: tx.to ?? null,
        data: tx.data ?? "0x",
        value: (tx.value ?? 0).toString(),
        policy,
        share: opts.share || undefined,
        probe: opts.probe || undefined,
        authorizationList: tx.authorizationList?.map((a) => ({ chainId: Number(a.chainId), address: a.address, nonce: a.nonce === undefined ? undefined : Number(a.nonce) })),
      }),
    });
  }

  /** Judge an EIP-712 typed-data or personal_sign request before signing it (Permit, Permit2, Seaport, …). */
  checkSignature(req: SignatureRequest, policy?: Policy, opts: { share?: boolean } = {}): Promise<SignatureCheckResult> {
    return this.request<SignatureCheckResult>("/v1/check-signature", {
      method: "POST",
      body: JSON.stringify({ chainId: req.chainId ?? 4663, signer: req.signer, typedData: req.typedData, message: req.message, authorization: req.authorization, policy, share: opts.share || undefined }),
    });
  }

  /** A verdict saved with `share: true`. */
  verdict(id: Hex): Promise<SharedVerdict> {
    return this.request<SharedVerdict>(`/v1/verdicts/${id}`);
  }

  /** Threat Board: denied patterns, most-denied addresses and the blocklist over the last 7 days. */
  threats(): Promise<ThreatBoard> {
    return this.request<ThreatBoard>("/v1/threats");
  }

  /** Wallet Check: every live token approval of a wallet with a risk level. Large histories finish over a few calls (`complete`, `progress`). */
  walletCheck(address: Address, opts: { refresh?: boolean } = {}): Promise<WalletReport> {
    return this.request<WalletReport>(`/v1/wallet/${address}${opts.refresh ? "?refresh=1" : ""}`);
  }

  /** Guardian Points of a wallet and the top of the leaderboard. */
  points(address: Address): Promise<PointsSummary> {
    return this.request<PointsSummary>(`/v1/points/${address}`);
  }
  leaderboard(): Promise<{ address: Address; total: number }[]> {
    return this.request(`/v1/points/leaderboard`);
  }

  /** Agent Arena: the current season and its standings. */
  arena(): Promise<{ season: { id: number; name: string; start: number; end: number; minTvl: number; minDepositors: number; prize?: string } | null; standings: { vault: Address; name: string; manager: Address; returnPct: number; maxDrawdownPct: number; tvl: number; depositors: number; eligible: boolean; reason?: string; rank?: number }[] }> {
    return this.request("/v1/arena");
  }

  /** Public check history of an agent wallet. */
  agent(address: Address): Promise<AgentStats> {
    return this.request<AgentStats>(`/v1/agents/${address}`);
  }

  signer(): Promise<{ signer: Address; ephemeral: boolean }> {
    return this.request("/v1/signer");
  }

  /** Agent Passport: Heimdall Score (0–100), tier, ERC-8004 identity and onchain reputation. By address or agentId. */
  passport(id: Address | bigint | number): Promise<Passport> {
    return this.request<Passport>(`/v1/passport/${id.toString()}`);
  }

  /** Link an ERC-8004 agentId to a wallet. Succeeds only when the chain shows the wallet owns or operates the agent. */
  linkPassport(address: Address, agentId: bigint | number): Promise<{ ok: true; agentId: string }> {
    return this.request("/v1/passport/link", { method: "POST", body: JSON.stringify({ address, agentId: agentId.toString() }) });
  }

  /** Token Check: simulated buy, sell and transfer through the token's Uniswap pool, taxes, clawback backdoors and fake tickers. */
  tokenCheck(token: Address): Promise<TokenCheckResult> {
    return this.request<TokenCheckResult>(`/v1/token/${token}`);
  }

  /** Risk data for an address: what Shield knows, and what the onchain Risk Oracle holds right now. */
  risk(address: Address): Promise<RiskReport> {
    return this.request<RiskReport>(`/v1/risk/${address}`);
  }
}

export interface TokenCheckResult {
  token: Address;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  owner: Address | null;
  verdict: "ALLOW" | "WARN" | "DENY";
  riskScore: number;
  findings: { code: string; severity: "info" | "warn" | "deny"; message: string }[];
  /** v3: the pool address; v4: the pool ID, with its hook. */
  pool: { version: 3 | 4; address: Address | Hex; fee: number; pair: "WETH" | "ETH"; liquidity: string; hooks?: Address } | null;
  buy: { ok: boolean; taxPct: number | null; reason?: string } | null;
  sell: { ok: boolean; taxPct: number | null; reason?: string } | null;
  transfer: { ok: boolean; taxPct: number | null; reason?: string } | null;
  pullableBy: ("anyone" | "owner")[];
  checkedAt: number;
}

export interface Passport {
  address: Address;
  agentId: string | null;
  linked: boolean;
  score: number | null;
  tier: "A" | "B" | "C" | "D" | "new" | "blocked";
  capped?: string;
  components: { name: "shield" | "pay" | "history"; score: number; weight: number; detail: string }[];
  identity: { agentId: string; owner: Address; wallet: Address | null; uri: string | null; registry: string; registration: { name?: string; description?: string; image?: string; services?: { name: string; endpoint: string }[]; x402Support?: boolean; active?: boolean } | null } | null;
  shield: AgentStats;
  pay: { completed: number; disputed: number; earnedUsdg: number } | null;
  risk: Omit<RiskReport, "oracle" | "onchain">;
  reputation: { count: number; average: number | null; publisher: Address; registry: Address } | null;
  updatedAt: string;
}

export interface RiskReport {
  address: Address;
  level: number;
  levelName: "none" | "low" | "warn" | "blocked";
  flags: number;
  flagNames: string[];
  label: string | null;
  source: string | null;
  blocked: boolean;
  oracle: Address | null;
  onchain: { level: number; flags: number; flagNames: string[]; updatedAt: string | null } | null;
}

/**
 * Check with Shield, then send only if the verdict is ALLOW (or WARN when `allowWarn`).
 * Throws HeimdallDenied otherwise. Returns the tx hash and the check result.
 */
export async function guardedSend(
  wallet: WalletClient,
  tx: { to: Address; data?: Hex; value?: bigint; chain?: Chain },
  opts: { shield: HeimdallShield; policy?: Policy; allowWarn?: boolean },
): Promise<{ hash: Hex; result: CheckResult }> {
  const account = wallet.account;
  if (!account) throw new HeimdallError("wallet has no account");
  const chainId = tx.chain?.id ?? wallet.chain?.id ?? 4663;
  const result = await opts.shield.check({ chainId, from: account.address, to: tx.to, data: tx.data, value: tx.value }, opts.policy);
  const ok = result.verdict === "ALLOW" || (opts.allowWarn && result.verdict === "WARN");
  if (!ok) throw new HeimdallDenied(result);
  const hash = await wallet.sendTransaction({ account, chain: tx.chain ?? wallet.chain, to: tx.to, data: tx.data, value: tx.value });
  return { hash, result };
}

// ───────────────────────────── Vault ─────────────────────────────

/** Turn a Shield receipt into the `(receipt, signature)` arguments of HeimdallVault.execute. */
export function receiptArgs(r: ShieldReceipt) {
  return {
    receipt: {
      agent: r.message.agent,
      target: r.message.target,
      dataHash: r.message.dataHash,
      value: BigInt(r.message.value),
      verdict: r.message.verdict,
      expiresAt: BigInt(r.message.expiresAt),
      checkId: r.message.checkId,
    },
    signature: r.signature,
  };
}

/**
 * Manager-agent flow: ask Shield about the call *as the vault*, then call vault.execute with the receipt.
 */
export async function executeThroughVault(
  wallet: WalletClient,
  params: { vault: Address; target: Address; data: Hex; chain?: Chain },
  opts: { shield: HeimdallShield; policy?: Policy },
): Promise<{ hash: Hex; result: CheckResult }> {
  const account = wallet.account;
  if (!account) throw new HeimdallError("wallet has no account");
  const chain = params.chain ?? wallet.chain;
  const result = await opts.shield.check({ chainId: chain?.id ?? 4663, from: params.vault, to: params.target, data: params.data, value: 0n }, opts.policy);
  if (result.verdict !== "ALLOW" || !result.receipt) throw new HeimdallDenied(result);
  const { receipt, signature } = receiptArgs(result.receipt);
  const hash = await wallet.writeContract({
    account, chain, address: params.vault, abi: heimdallVaultAbi, functionName: "execute",
    args: [params.target, params.data, receipt, signature],
  });
  return { hash, result };
}

// ───────────────────────────── Signals (pay-per-call vouchers) ─────────────────────────────

export const VOUCHER_TYPES = {
  Voucher: [
    { name: "payer", type: "address" },
    { name: "signalId", type: "uint256" },
    { name: "cumulativeAmount", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface Voucher { payer: Address; signalId: bigint; cumulativeAmount: bigint; deadline: bigint }
export interface SignedVoucher { voucher: Voucher; signature: Hex }

export const VOUCHER_HEADER = "x-heimdall-voucher";

export function signalsDomain(chainId: number, signals: Address) {
  return { name: "Heimdall Signals", version: "1", chainId, verifyingContract: signals } as const;
}

/** Agent side: sign a cumulative voucher (total ever owed to this signal). No gas. */
export async function signVoucher(
  wallet: WalletClient,
  p: { chainId: number; signals: Address; signalId: bigint; cumulativeAmount: bigint; deadline?: bigint },
): Promise<SignedVoucher> {
  const account = wallet.account;
  if (!account) throw new HeimdallError("wallet has no account");
  const voucher: Voucher = {
    payer: account.address,
    signalId: p.signalId,
    cumulativeAmount: p.cumulativeAmount,
    deadline: p.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
  };
  const signature = await wallet.signTypedData({
    account, domain: signalsDomain(p.chainId, p.signals), types: VOUCHER_TYPES, primaryType: "Voucher", message: voucher,
  });
  return { voucher, signature };
}

/** Encode a voucher for the `x-heimdall-voucher` HTTP header. */
export function encodeVoucherHeader(v: SignedVoucher): string {
  return Buffer.from(JSON.stringify({ ...v.voucher, signalId: v.voucher.signalId.toString(), cumulativeAmount: v.voucher.cumulativeAmount.toString(), deadline: v.voucher.deadline.toString(), signature: v.signature })).toString("base64url");
}

export function decodeVoucherHeader(h: string): SignedVoucher {
  const o = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  return {
    voucher: { payer: getAddress(o.payer), signalId: BigInt(o.signalId), cumulativeAmount: BigInt(o.cumulativeAmount), deadline: BigInt(o.deadline) },
    signature: o.signature as Hex,
  };
}

/**
 * Provider side: accept a call only if the voucher is signed by the payer, covers at least one more call
 * than already accepted, and the payer's prefunded balance can pay it.
 * `acceptedCumulative` is what the provider has already accepted from this payer (its own bookkeeping).
 */
export async function verifyVoucher(
  client: PublicClient,
  p: { chainId: number; signals: Address; signalId: bigint; pricePerCall: bigint; acceptedCumulative: bigint; signed: SignedVoucher },
): Promise<{ ok: true; newCumulative: bigint } | { ok: false; reason: string }> {
  const { voucher, signature } = p.signed;
  if (voucher.signalId !== p.signalId) return { ok: false, reason: "wrong signal" };
  if (voucher.deadline < BigInt(Math.floor(Date.now() / 1000))) return { ok: false, reason: "voucher expired" };
  const recovered = await recoverTypedDataAddress({
    domain: signalsDomain(p.chainId, p.signals), types: VOUCHER_TYPES, primaryType: "Voucher", message: voucher, signature,
  });
  if (recovered.toLowerCase() !== voucher.payer.toLowerCase()) return { ok: false, reason: "bad signature" };
  if (voucher.cumulativeAmount < p.acceptedCumulative + p.pricePerCall) return { ok: false, reason: "voucher does not cover this call" };
  // `available` = pre-funded balance minus any pending withdrawal, so a payer can't pull funds after you served them.
  const [balance, claimed] = await Promise.all([
    client.readContract({ address: p.signals, abi: heimdallSignalsAbi, functionName: "available", args: [voucher.payer] }),
    client.readContract({ address: p.signals, abi: heimdallSignalsAbi, functionName: "claimed", args: [voucher.payer, voucher.signalId] }),
  ]);
  if (voucher.cumulativeAmount - claimed > balance) return { ok: false, reason: "payer balance too low" };
  return { ok: true, newCumulative: voucher.cumulativeAmount };
}

export const dataHash = (data: Hex) => keccak256(data);

export { gateVoucher, MemoryLedger, type VoucherLedger, type GateConfig, type GateResult } from "./provider.js";
