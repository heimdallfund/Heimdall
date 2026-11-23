import { type Hex, keccak256, zeroAddress } from "viem";
import { getSigner } from "./signer.js";
import type { SignedReceipt, TxIntent, Verdict } from "./types.js";

export const RECEIPT_TYPES = {
  Receipt: [
    { name: "agent", type: "address" },
    { name: "target", type: "address" },
    { name: "dataHash", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "verdict", type: "uint8" },
    { name: "expiresAt", type: "uint64" },
    { name: "checkId", type: "bytes32" },
  ],
} as const;

export const VERDICT_CODE: Record<Verdict, number> = { ALLOW: 0, WARN: 1, DENY: 2 };

export function receiptDomain(chainId: number) {
  return { name: "Heimdall Shield", version: "1", chainId } as const;
}

/** Sign an EIP-712 receipt that an onchain guard (Heimdall Vault) can verify before executing. */
export async function signReceipt(tx: TxIntent, verdict: Verdict, checkId: Hex, ttlSeconds = 120): Promise<SignedReceipt> {
  const signer = await getSigner();
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const message = {
    agent: tx.from,
    target: tx.to ?? zeroAddress,
    dataHash: keccak256(tx.data),
    value: tx.value,
    verdict: VERDICT_CODE[verdict],
    expiresAt: BigInt(expiresAt),
    checkId,
  };
  const signature = await signer.signTypedData({
    domain: receiptDomain(tx.chainId),
    types: RECEIPT_TYPES,
    primaryType: "Receipt",
    message,
  });
  return {
    signer: signer.address,
    signature,
    expiresAt,
    message: { ...message, value: message.value.toString(), expiresAt: String(expiresAt) },
  };
}
