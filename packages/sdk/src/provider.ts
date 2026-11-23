import type { Address, PublicClient } from "viem";
import { decodeVoucherHeader, verifyVoucher, type SignedVoucher } from "./index.js";

/** Where a provider keeps the cumulative amount it has accepted per payer, and the latest voucher to redeem. */
export interface VoucherLedger {
  getAccepted(payer: Address, signalId: bigint): Promise<bigint>;
  /** Atomically move from `expected` to `next`; return false if someone else moved it first. */
  advance(payer: Address, signalId: bigint, expected: bigint, next: bigint, voucher: SignedVoucher): Promise<boolean>;
  /** Latest accepted voucher per payer, for onchain redemption. */
  pending(signalId: bigint): Promise<SignedVoucher[]>;
}

export class MemoryLedger implements VoucherLedger {
  private accepted = new Map<string, bigint>();
  private latest = new Map<string, SignedVoucher>();
  private key = (p: Address, id: bigint) => `${p.toLowerCase()}:${id}`;
  async getAccepted(p: Address, id: bigint) { return this.accepted.get(this.key(p, id)) ?? 0n; }
  async advance(p: Address, id: bigint, expected: bigint, next: bigint, v: SignedVoucher) {
    const k = this.key(p, id);
    if ((this.accepted.get(k) ?? 0n) !== expected) return false;
    this.accepted.set(k, next);
    this.latest.set(k, v);
    return true;
  }
  async pending(id: bigint) { return [...this.latest.entries()].filter(([k]) => k.endsWith(`:${id}`)).map(([, v]) => v); }
}

export interface GateConfig {
  chainId: number;
  signals: Address;
  signalId: bigint;
  pricePerCall: bigint; // USDG base units (6 decimals)
  client: PublicClient;
  ledger: VoucherLedger;
}

export type GateResult =
  | { ok: true; payer: Address; commit: () => Promise<boolean> }
  | { ok: false; status: 402 | 409; body: Record<string, unknown> };

/**
 * x402-style gate for a signal endpoint.
 * 1. No / bad voucher → 402 with payment instructions.
 * 2. Valid voucher covering one more call → ok; call `commit()` only after you produced the answer,
 *    so agents are never charged for a failed call.
 */
export async function gateVoucher(cfg: GateConfig, header: string | null | undefined): Promise<GateResult> {
  const paymentRequired = (reason: string): GateResult => ({
    ok: false,
    status: 402,
    body: {
      error: "payment_required",
      reason,
      payment: {
        scheme: "heimdall-voucher",
        chainId: cfg.chainId,
        contract: cfg.signals,
        signalId: cfg.signalId.toString(),
        pricePerCall: cfg.pricePerCall.toString(),
        currency: "USDG",
        decimals: 6,
        header: "x-heimdall-voucher",
        howTo: "Prefund with HeimdallSignals.fund(amount), then send a cumulative EIP-712 Voucher signed by the payer (see @heimdall/sdk signVoucher).",
      },
    },
  });
  if (!header) return paymentRequired("missing voucher");
  let signed: SignedVoucher;
  try { signed = decodeVoucherHeader(header); } catch { return paymentRequired("malformed voucher"); }
  const accepted = await cfg.ledger.getAccepted(signed.voucher.payer, cfg.signalId);
  const v = await verifyVoucher(cfg.client, {
    chainId: cfg.chainId, signals: cfg.signals, signalId: cfg.signalId, pricePerCall: cfg.pricePerCall, acceptedCumulative: accepted, signed,
  });
  if (!v.ok) return paymentRequired(v.reason);
  return {
    ok: true,
    payer: signed.voucher.payer,
    commit: () => cfg.ledger.advance(signed.voucher.payer, cfg.signalId, accepted, v.newCumulative, signed),
  };
}
