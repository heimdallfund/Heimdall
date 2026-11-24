import type { Address, Hex } from "viem";

export type Severity = "info" | "warn" | "deny";
export type Verdict = "ALLOW" | "WARN" | "DENY";

export interface Finding {
  code: string;
  severity: Severity;
  message: string;
}

export interface TxIntent {
  chainId: number;
  from: Address;
  to: Address | null;
  data: Hex;
  value: bigint;
  /** EIP-7702 authorizations carried by a type 4 transaction. */
  authorizationList?: { chainId: number | string; address: string; nonce?: number | string }[];
  /** Internal only (Token Check): balances to give accounts before simulating, e.g. ETH for a probe buyer. Never from the API. */
  overrides?: Record<string, { balance?: Hex }>;
}

export interface AssetChange {
  asset: Address; // NATIVE_ASSET for ETH
  symbol: string;
  decimals: number;
  kind: "native" | "erc20" | "erc721";
  /** signed raw amount for `from` (negative = leaves the agent wallet) */
  delta: bigint;
  /** set for erc721 */
  tokenIds?: bigint[];
  counterparties: Address[];
}

export interface ApprovalInfo {
  standard: "erc20" | "erc721-all" | "permit2";
  token: Address;
  spender: Address;
  amount?: bigint;
  unlimited: boolean;
  revoke: boolean;
}

export interface CheckResult {
  checkId: Hex;
  verdict: Verdict;
  riskScore: number; // 0..100
  summary: string[];
  findings: Finding[];
  decoded?: { functionName: string; signature: string; args: unknown[] };
  approvals: ApprovalInfo[];
  assetChanges: AssetChange[];
  simulation: { ok: boolean; available: boolean; gasUsed?: bigint; revertReason?: string };
  receipt?: SignedReceipt;
}

export interface SignedReceipt {
  signer: Address;
  signature: Hex;
  expiresAt: number;
  message: {
    agent: Address;
    target: Address;
    dataHash: Hex;
    value: string;
    verdict: number;
    expiresAt: string;
    checkId: Hex;
  };
}
