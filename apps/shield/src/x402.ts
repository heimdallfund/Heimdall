import { getAddress, isAddress, parseAbi, parseSignature, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import type { CounterStore } from "./store.js";

/**
 * x402 on Robinhood Chain, in USDG (exact scheme, EIP-3009 transferWithAuthorization).
 *
 * Two roles live here:
 *  - Resource server: Shield's own paid endpoints answer 402 with a PAYMENT-REQUIRED header when a keyless caller is
 *    out of free quota, and accept a PAYMENT-SIGNATURE header instead of an API key.
 *  - Facilitator: POST /x402/verify and /x402/settle for any x402 server on Robinhood Chain. Before a payment is
 *    settled, the recipient is checked against Heimdall's risk list, so agents never pay a known drainer.
 *
 * Spec: x402 v2 (x402Version 2, CAIP-2 network "eip155:4663"); v1 bodies ("robinhood", X-PAYMENT) are accepted.
 */

export interface X402Network { chainId: number; network: string; legacyNetwork: string; asset: Address; name: string; version: string }

/** USDG on Robinhood Chain mainnet: EIP-712 domain verified onchain (name "Global Dollar", version "1"). */
export const ROBINHOOD_USDG: X402Network = {
  chainId: 4663,
  network: "eip155:4663",
  legacyNetwork: "robinhood",
  asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  name: "Global Dollar",
  version: "1",
};

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  amount: string;
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface ResourceInfo { url: string; description?: string; mimeType?: string; serviceName?: string; tags?: string[] }

export interface Authorization { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex }

export interface PaymentPayload {
  x402Version: number;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  payload: { signature: Hex; authorization: Authorization };
  extensions?: Record<string, unknown>;
}

export interface VerifyResponse { isValid: boolean; invalidReason?: string; payer?: Address; extra?: Record<string, unknown> }
export interface SettlementResponse { success: boolean; errorReason?: string; payer?: Address; transaction: string; network: string; amount?: string }

const AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const EIP3009_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

export function requirementsFor(net: X402Network, amount: bigint | string, payTo: Address, maxTimeoutSeconds = 60): PaymentRequirements {
  return {
    scheme: "exact",
    network: net.network,
    amount: String(amount),
    asset: net.asset,
    payTo: getAddress(payTo),
    maxTimeoutSeconds,
    extra: { name: net.name, version: net.version, assetTransferMethod: "eip3009" },
  };
}

/** The 402 object (PAYMENT-REQUIRED header, base64). `discoverable` adds the Bazaar extension so it can be listed. */
export function paymentRequired(resource: ResourceInfo, accepts: PaymentRequirements[], error?: string, discoverable = true) {
  return {
    x402Version: 2,
    ...(error ? { error } : {}),
    resource,
    accepts,
    extensions: discoverable ? { bazaar: { info: { discoverable: true }, schema: { type: "object" } } } : {},
  };
}

export const encodeHeader = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
export function decodeHeader<T>(h: string): T | null {
  try {
    return JSON.parse(Buffer.from(h, "base64").toString("utf8")) as T;
  } catch {
    try { return JSON.parse(h) as T; } catch { return null; }
  }
}

/**
 * Accept a v2 PaymentPayload, or a v1 one ({ x402Version: 1, scheme, network: "robinhood", payload }) by attaching the
 * requirements it was made for.
 */
export function normalizePayload(raw: unknown, req: PaymentRequirements, net: X402Network): PaymentPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, any>;
  if (!p.payload?.authorization || !p.payload?.signature) return null;
  if (p.x402Version === 1) {
    const network = p.network === net.legacyNetwork ? net.network : p.network;
    return { x402Version: 1, accepted: { ...req, scheme: p.scheme, network }, payload: p.payload };
  }
  return p as PaymentPayload;
}

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export interface VerifyOptions {
  net?: X402Network;
  nowSec?: number;
  /** Heimdall check on the recipient. True = refuse the payment. */
  recipientBlocked?: (a: Address) => Promise<boolean> | boolean;
  /** Smallest payment the facilitator settles (raw units), so nobody can make it burn gas on dust. */
  minAmount?: bigint;
}

/** Facilitator /verify: every check of the exact-EVM scheme, plus Heimdall's recipient check. Never throws. */
export async function verifyPayment(client: PublicClient, payload: PaymentPayload, req: PaymentRequirements, o: VerifyOptions = {}): Promise<VerifyResponse> {
  const net = o.net ?? ROBINHOOD_USDG;
  const a = payload?.payload?.authorization;
  const payer = a && isAddress(a.from) ? getAddress(a.from) : undefined;
  const bad = (invalidReason: string): VerifyResponse => ({ isValid: false, invalidReason, payer });
  if (payload?.x402Version !== 1 && payload?.x402Version !== 2) return bad("invalid_x402_version");
  if (req.scheme !== "exact" || payload.accepted?.scheme !== "exact") return bad("unsupported_scheme");
  if (req.network !== net.network || payload.accepted?.network !== net.network) return bad("invalid_network");
  if (!same(req.asset, net.asset) || !same(payload.accepted?.asset, net.asset)) return bad("invalid_exact_evm_payload_asset");
  if (!a || !payer || !isAddress(a.to)) return bad("invalid_payload");
  if (!same(a.to, req.payTo) || !same(payload.accepted.payTo, req.payTo)) return bad("invalid_exact_evm_payload_recipient_mismatch");
  let value: bigint, validAfter: bigint, validBefore: bigint;
  try {
    value = BigInt(a.value);
    validAfter = BigInt(a.validAfter);
    validBefore = BigInt(a.validBefore);
  } catch {
    return bad("invalid_payload");
  }
  if (value !== BigInt(req.amount) || payload.accepted.amount !== undefined && BigInt(payload.accepted.amount) !== BigInt(req.amount)) {
    return bad("invalid_exact_evm_payload_authorization_value");
  }
  if (o.minAmount && value < o.minAmount) return bad("invalid_exact_evm_payload_authorization_value");
  const now = BigInt(o.nowSec ?? Math.floor(Date.now() / 1000));
  if (validAfter > now) return bad("invalid_exact_evm_payload_authorization_valid_after");
  // a few seconds of headroom so the settlement transaction can still land
  if (validBefore < now + 6n) return bad("invalid_exact_evm_payload_authorization_valid_before");
  if (!/^0x[0-9a-fA-F]{64}$/.test(a.nonce)) return bad("invalid_payload");
  if (!/^0x[0-9a-fA-F]{130}$/.test(payload.payload.signature)) return bad("invalid_exact_evm_payload_signature");
  const sigOk = await client.verifyTypedData({
    address: payer,
    domain: { name: net.name, version: net.version, chainId: net.chainId, verifyingContract: net.asset },
    types: AUTH_TYPES,
    primaryType: "TransferWithAuthorization",
    message: { from: payer, to: getAddress(a.to), value, validAfter, validBefore, nonce: a.nonce },
    signature: payload.payload.signature,
  }).catch(() => false);
  if (!sigOk) return bad("invalid_exact_evm_payload_signature");
  if (o.recipientBlocked && (await o.recipientBlocked(getAddress(a.to)))) return bad("heimdall_recipient_blocked");
  try {
    const [balance, used] = await Promise.all([
      client.readContract({ address: net.asset, abi: EIP3009_ABI, functionName: "balanceOf", args: [payer] }),
      client.readContract({ address: net.asset, abi: EIP3009_ABI, functionName: "authorizationState", args: [payer, a.nonce] }),
    ]);
    if (balance < value) return bad("insufficient_funds");
    if (used) return bad("invalid_exact_evm_payload_authorization_nonce_used");
  } catch {
    return bad("unexpected_verify_error");
  }
  return { isValid: true, payer };
}

/** Facilitator /settle: verify again, then broadcast transferWithAuthorization and wait for it. Idempotent per nonce. */
export async function settlePayment(
  wallet: WalletClient,
  client: PublicClient,
  payload: PaymentPayload,
  req: PaymentRequirements,
  o: VerifyOptions & { store?: CounterStore; onSettled?: (r: SettlementResponse, p: PaymentPayload) => Promise<void> | void } = {},
): Promise<SettlementResponse> {
  const net = o.net ?? ROBINHOOD_USDG;
  const a = payload?.payload?.authorization;
  const key = a ? `x402:settled:${String(a.from).toLowerCase()}:${a.nonce}` : null;
  if (key && o.store) {
    const prev = await o.store.fetch(key).catch(() => null);
    if (prev) return JSON.parse(prev) as SettlementResponse;
  }
  const v = await verifyPayment(client, payload, req, o);
  if (!v.isValid) return { success: false, errorReason: v.invalidReason, payer: v.payer, transaction: "", network: net.network };
  const sig = parseSignature(payload.payload.signature);
  try {
    const hash = await wallet.writeContract({
      address: net.asset,
      abi: EIP3009_ABI,
      functionName: "transferWithAuthorization",
      args: [getAddress(a.from), getAddress(a.to), BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, Number(sig.v ?? BigInt(sig.yParity + 27)), sig.r, sig.s],
      account: wallet.account!,
      chain: wallet.chain,
    });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 30_000 });
    const res: SettlementResponse = receipt.status === "success"
      ? { success: true, payer: v.payer, transaction: hash, network: net.network, amount: a.value }
      : { success: false, errorReason: "invalid_transaction_state", payer: v.payer, transaction: hash, network: net.network };
    if (res.success && key && o.store) await o.store.put(key, JSON.stringify(res), 7 * 86_400).catch(() => {});
    if (res.success) await o.onSettled?.(res, payload);
    return res;
  } catch (e) {
    return { success: false, errorReason: "unexpected_settle_error", payer: v.payer, transaction: "", network: net.network };
  }
}

// ── Discovery (Bazaar) ───────────────────────────────────────────────────────

export interface DiscoveryItem { resource: string; type: "http"; x402Version: number; accepts: PaymentRequirements[]; lastUpdated: string; metadata?: Record<string, unknown> }

const DISCOVERY_TTL = 30 * 86_400;

/** Remember a resource that was paid through this facilitator and asked to be discoverable (Bazaar extension). */
export async function rememberResource(store: CounterStore, payload: PaymentPayload, req: PaymentRequirements) {
  const url = payload.resource?.url;
  if (!url || !/^https:\/\//.test(url) || !payload.extensions?.bazaar) return;
  const item: DiscoveryItem = {
    resource: url, type: "http", x402Version: payload.x402Version, accepts: [req], lastUpdated: new Date().toISOString(),
    metadata: { description: payload.resource?.description, mimeType: payload.resource?.mimeType, serviceName: payload.resource?.serviceName, tags: payload.resource?.tags },
  };
  await store.put(`x402:resource:${url}`, JSON.stringify(item), DISCOVERY_TTL);
  await store.addMember("x402:resources", url);
}

export async function discovery(store: CounterStore, own: DiscoveryItem[], q: { limit?: number; offset?: number; payTo?: string } = {}) {
  const urls = await store.members("x402:resources");
  const seen = (await Promise.all(urls.map((u) => store.fetch(`x402:resource:${u}`)))).filter((x): x is string => !!x).map((x) => JSON.parse(x) as DiscoveryItem);
  let items = [...own, ...seen.filter((s) => !own.some((o) => o.resource === s.resource))];
  if (q.payTo) items = items.filter((i) => i.accepts.some((a) => same(a.payTo, q.payTo)));
  const limit = Math.min(100, Math.max(1, q.limit ?? 20));
  const offset = Math.max(0, q.offset ?? 0);
  return { x402Version: 2, items: items.slice(offset, offset + limit), pagination: { limit, offset, total: items.length } };
}
