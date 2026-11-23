import { formatUnits, type Address, type Hex } from "viem";

export const STATUS = ["None", "Open", "Submitted", "Disputed", "Released", "Refunded", "Resolved"] as const;
export type Status = (typeof STATUS)[number];
export interface PayJob {
  id: bigint; client: Address; provider: Address; arbiter: Address; amount: bigint; deadline: bigint; reviewWindow: number;
  submittedAt: bigint; arbiterFeeBps: number; feeBps: number; disputedAt: bigint; status: Status; specHash: Hex; resultHash: Hex;
}
export const toJob = (id: bigint, j: Record<string, unknown>): PayJob => ({ id, ...(j as object), status: STATUS[Number(j.status)] } as PayJob);
export const usdg = (v: bigint) => Number(formatUnits(v, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const TONE: Record<Status, string> = {
  None: "bg-ink-2 text-muted", Open: "bg-brand-soft text-brand", Submitted: "bg-warn-soft text-warn", Disputed: "bg-deny-soft text-deny",
  Released: "bg-allow-soft text-allow", Refunded: "bg-ink-2 text-muted", Resolved: "bg-allow-soft text-allow",
};
export const NO_ARBITER = "0x0000000000000000000000000000000000000000";
