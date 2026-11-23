import { z } from "zod";
import { isAddress } from "viem";

const addr = z.string().refine((v) => isAddress(v), "invalid address");
const uintStr = z.string().regex(/^\d+$/, "must be a base-10 integer string");

/** Per-agent guardrails. Everything is optional; defaults are the safe baseline. */
export const PolicySchema = z.object({
  /** Escalate every WARN to DENY. */
  strict: z.boolean().default(false),
  /** If set, the transaction target must be in this list. */
  allowTargets: z.array(addr).optional(),
  /** Targets that are always denied. */
  denyTargets: z.array(addr).default([]),
  /** Max native ETH (wei) that may leave the agent wallet in one tx. */
  maxNativeOut: uintStr.optional(),
  /** Max raw amount per ERC-20 token that may leave the wallet in one tx. */
  maxTokenOut: z.record(z.string(), uintStr).default({}),
  /** Allow unlimited approvals to trusted spenders without a warning. */
  trustedSpenders: z.array(addr).default([]),
  /** Never allow unlimited approvals, even to trusted spenders. */
  denyUnlimitedApprovals: z.boolean().default(false),
  /** Allow contract deployment (to = null). */
  allowContractDeploy: z.boolean().default(false),
  /** Recipients the agent may send assets to without a warning (e.g. owner, treasury). */
  trustedRecipients: z.array(addr).default([]),
}).prefault({});

export type Policy = z.infer<typeof PolicySchema>;

export const lc = (a: string) => a.toLowerCase();
export const inList = (list: readonly string[] | undefined, a?: string | null) =>
  !!a && !!list && list.some((x) => lc(x) === lc(a));
