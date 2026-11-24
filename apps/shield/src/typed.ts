import { type Address, type PublicClient, getAddress, isAddress, isHex, maxUint256 } from "viem";
import { judgeAuthorization, type Authorization } from "./delegation.js";
import { fakeTokenCheck } from "./impersonation.js";
import { knownContract } from "./chains.js";
import { isBlocklisted } from "./blocklist.js";
import { inList, type Policy } from "./policy.js";
import type { Finding, Verdict } from "./types.js";

/** EIP-712 payload as wallets receive it for eth_signTypedData_v4. */
export interface TypedDataInput {
  domain?: { name?: string; version?: string; chainId?: number | string; verifyingContract?: string; salt?: string };
  types?: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface SignatureCheckResult {
  verdict: Verdict;
  riskScore: number;
  kind: string;
  summary: string[];
  findings: Finding[];
  approvals: { token: Address; spender: Address; amount?: string; unlimited: boolean; expiresAt?: number }[];
}

const MAX_UINT160 = (1n << 160n) - 1n;
const UNLIMITED = 1n << 128n;
const LONG_EXPIRY_SECONDS = 30 * 86_400;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const big = (v: unknown): bigint => {
  try { return BigInt(v as string | number | bigint); } catch { return 0n; }
};
const addr = (v: unknown): Address | null => (typeof v === "string" && isAddress(v) ? getAddress(v) : null);

async function isContract(client: PublicClient, a: Address) {
  const code = await client.getCode({ address: a }).catch(() => undefined);
  return !!code && code !== "0x";
}

/**
 * Judge an offchain signature request BEFORE the agent signs it.
 * Covers EIP-2612 Permit, DAI-style Permit, Uniswap Permit2 (PermitSingle/Batch, PermitTransferFrom/Batch),
 * Seaport orders, and blind `personal_sign` of a 32-byte hash.
 */
export async function checkTypedData(
  chainId: number,
  signer: Address,
  td: TypedDataInput,
  policy: Policy,
  client: PublicClient,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<SignatureCheckResult> {
  const F: Finding[] = [];
  const add = (code: string, severity: Finding["severity"], message: string) => F.push({ code, severity, message });
  const summary: string[] = [];
  const approvals: SignatureCheckResult["approvals"] = [];
  const m = td.message ?? {};
  const domainChain = td.domain?.chainId !== undefined ? Number(td.domain.chainId) : undefined;
  const vc = addr(td.domain?.verifyingContract);
  let kind = "unknown";

  if (domainChain !== undefined && domainChain !== chainId) {
    add("WRONG_CHAIN", "deny", `Signature is for chain ${domainChain}, not ${chainId}. It could be replayed elsewhere.`);
  }

  const grant = async (token: Address, spender: Address, amount: bigint | undefined, unlimited: boolean, expiresAt?: number, std = "Permit") => {
    approvals.push({ token, spender, amount: amount?.toString(), unlimited, expiresAt });
    const label = knownContract(chainId, token)?.name ?? short(token);
    summary.push(`${std}: lets ${short(spender)} spend ${unlimited ? "UNLIMITED" : amount?.toString() ?? "?"} ${label}${expiresAt ? ` until ${new Date(expiresAt * 1000).toISOString().slice(0, 10)}` : ""}`);
    if (isBlocklisted(spender)) { add("BLOCKLISTED_SPENDER", "deny", `Spender ${short(spender)} is on the Heimdall blocklist.`); return; }
    const fake = await fakeTokenCheck(client, token).catch(() => undefined);
    if (fake) add("FAKE_TOKEN", fake.by === "symbol" ? "deny" : "warn", `${short(token)} calls itself ${fake.symbol}, but the real ${fake.symbol} is ${short(fake.real)}.`);
    const trusted = inList(policy.trustedSpenders, spender);
    if (!trusted && !(await isContract(client, spender))) {
      add(unlimited ? "PERMIT_UNLIMITED_TO_EOA" : "PERMIT_TO_EOA", "deny", `Signing lets the plain wallet ${short(spender)} take your ${label}: the most common drainer signature.`);
      return;
    }
    if (unlimited) {
      if (policy.denyUnlimitedApprovals) add("PERMIT_UNLIMITED", "deny", `Unlimited ${label} permit; policy forbids unlimited approvals.`);
      else if (!trusted) add("PERMIT_UNLIMITED", "warn", `Unlimited ${label} permit to ${short(spender)}. Prefer an exact amount.`);
    }
    if (expiresAt && expiresAt - nowSec > LONG_EXPIRY_SECONDS && !trusted) {
      add("PERMIT_LONG_EXPIRY", "warn", `Permit stays valid for ${Math.round((expiresAt - nowSec) / 86_400)} days.`);
    }
  };

  const pt = td.primaryType;
  if (pt === "Permit" && "spender" in m && "value" in m && vc) {
    kind = "erc2612-permit";
    const v = big(m.value);
    await grant(vc, addr(m.spender)!, v, v >= UNLIMITED || v === maxUint256, Number(big(m.deadline)) || undefined, "Permit");
    if (addr(m.owner) && addr(m.owner) !== signer) add("OWNER_MISMATCH", "warn", "Permit owner is not the signing wallet.");
  } else if (pt === "Permit" && "allowed" in m && "spender" in m && vc) {
    kind = "dai-permit";
    if (m.allowed === true || m.allowed === "true") await grant(vc, addr(m.spender)!, undefined, true, Number(big(m.expiry)) || undefined, "DAI permit");
    else summary.push("Revokes a DAI-style permit.");
  } else if (pt === "PermitSingle" || pt === "PermitBatch") {
    kind = `permit2-${pt === "PermitSingle" ? "single" : "batch"}`;
    const spender = addr(m.spender);
    const details = (pt === "PermitSingle" ? [m.details] : (m.details as unknown[])) as Record<string, unknown>[];
    for (const d of details ?? []) {
      const amount = big(d?.amount);
      const token = addr(d?.token);
      if (token && spender) await grant(token, spender, amount, amount >= MAX_UINT160 || amount >= UNLIMITED, Number(big(d?.expiration)) || undefined, "Permit2");
    }
  } else if (pt === "PermitTransferFrom" || pt === "PermitBatchTransferFrom" || pt === "PermitWitnessTransferFrom" || pt === "PermitBatchWitnessTransferFrom") {
    kind = "permit2-transfer";
    const spender = addr(m.spender);
    const permitted = (Array.isArray(m.permitted) ? m.permitted : [m.permitted]) as Record<string, unknown>[];
    for (const p of permitted) {
      const token = addr(p?.token);
      const amount = big(p?.amount);
      if (token && spender) await grant(token, spender, amount, amount >= UNLIMITED, Number(big(m.deadline)) || undefined, "Permit2 transfer");
    }
  } else if (pt === "OrderComponents" && "offer" in m && "consideration" in m) {
    kind = "seaport-order";
    const offerer = addr(m.offerer);
    const consideration = (m.consideration as Record<string, unknown>[]) ?? [];
    const toOfferer = consideration.filter((c) => addr(c.recipient) === offerer);
    summary.push(`Marketplace order: gives ${(m.offer as unknown[]).length} item(s), receives ${toOfferer.length} payment item(s).`);
    if (!toOfferer.length || toOfferer.every((c) => big(c.startAmount) === 0n)) {
      add("ORDER_FOR_NOTHING", "deny", "This order gives your assets away and pays you nothing.");
    } else add("MARKET_ORDER", "warn", "Signing lists assets for sale. Make sure the price is what you expect.");
  } else {
    summary.push(`Typed data "${pt}" for ${td.domain?.name ?? "unknown app"}${vc ? ` (${short(vc)})` : ""}.`);
    add("UNKNOWN_TYPED_DATA", "warn", "Heimdall does not recognise this signature type. Only sign if you know the app.");
  }

  if (vc && isBlocklisted(vc)) add("BLOCKLISTED_CONTRACT", "deny", `Verifying contract ${short(vc)} is on the Heimdall blocklist.`);

  return finish(F, kind, summary, approvals, policy);
}

/** EIP-7702 authorization tuple: which code the wallet would run, on which chains. */
export async function checkAuthorization(chainId: number, auth: Authorization, policy: Policy, client: PublicClient): Promise<SignatureCheckResult> {
  const { findings, summary } = await judgeAuthorization(auth, chainId, policy, client);
  return finish(findings, "eip7702-authorization", [summary], [], policy);
}

/** personal_sign / eth_sign: a bare 32-byte hash is blind signing and is denied. */
export function checkPersonalMessage(message: string, policy: Policy): SignatureCheckResult {
  const F: Finding[] = [];
  const summary: string[] = [];
  if (isHex(message) && message.length === 66) {
    F.push({ code: "BLIND_HASH_SIGNATURE", severity: "deny", message: "Signing a raw 32-byte hash can authorise anything, including a transaction. Never blind-sign." });
    summary.push("Signs an opaque 32-byte hash.");
  } else {
    const text = isHex(message) ? Buffer.from(message.slice(2), "hex").toString("utf8") : message;
    summary.push(`Signs a text message (${text.length} characters).`);
    if (/permit|approve|transfer|seed|private key/i.test(text)) {
      F.push({ code: "SUSPICIOUS_MESSAGE", severity: "warn", message: "The message mentions approvals, transfers or keys. Read it carefully." });
    }
  }
  return finish(F, "personal-sign", summary, [], policy);
}

function finish(F: Finding[], kind: string, summary: string[], approvals: SignatureCheckResult["approvals"], policy: Policy): SignatureCheckResult {
  const deny = F.some((f) => f.severity === "deny");
  const warn = F.some((f) => f.severity === "warn");
  const verdict: Verdict = deny ? "DENY" : warn ? (policy.strict ? "DENY" : "WARN") : "ALLOW";
  const riskScore = deny ? Math.min(100, 85 + F.filter((f) => f.severity === "deny").length * 5) : warn ? Math.min(80, F.filter((f) => f.severity === "warn").length * 25) : 0;
  return { verdict, riskScore, kind, summary, findings: F, approvals };
}
