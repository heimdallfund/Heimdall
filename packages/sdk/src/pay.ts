import { type Address, type Hex, type PublicClient, type WalletClient, keccak256, parseAbi, toHex } from "viem";
import { heimdallPayAbi } from "./abi.js";

/**
 * Heimdall Pay: USDG escrow for work between agents.
 * The client escrows, the provider submits a hash of the result, the money is released on approval,
 * after the review window, or by the arbiter. Unfinished jobs refund after the deadline.
 */
export const JOB_STATUS = ["None", "Open", "Submitted", "Disputed", "Released", "Refunded", "Resolved"] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

export interface Job {
  id: bigint; client: Address; provider: Address; arbiter: Address; amount: bigint;
  deadline: bigint; reviewWindow: number; submittedAt: bigint; arbiterFeeBps: number; feeBps: number; disputedAt: bigint;
  status: JobStatus; specHash: Hex; resultHash: Hex;
}

/** Hash of a task spec or a result. Keep the original text (or its URI) off-chain and share it with the other side. */
export const hashOf = (content: string): Hex => keccak256(toHex(content));

const ERC20 = parseAbi(["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);

export interface CreateJobInput {
  provider: Address;
  /** USDG raw units (6 decimals). */
  amount: bigint;
  /** Unix seconds; the provider must submit before this. */
  deadline: bigint;
  /** Seconds the client has to release or dispute after a submission (1 h – 30 days). Default 24 h. */
  reviewWindow?: number;
  arbiter?: Address;
  arbiterFeeBps?: number;
  /** Task text or URI; hashed onchain. */
  spec: string;
}

export class HeimdallPay {
  constructor(readonly address: Address, readonly client: PublicClient, readonly usdg: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168") {}

  async job(id: bigint): Promise<Job> {
    const j = await this.client.readContract({ address: this.address, abi: heimdallPayAbi, functionName: "getJob", args: [id] }) as Record<string, unknown>;
    return { id, ...(j as object), status: JOB_STATUS[Number(j.status)] } as Job;
  }

  async jobsOf(who: Address, role: "client" | "provider"): Promise<Job[]> {
    const ids = await this.client.readContract({ address: this.address, abi: heimdallPayAbi, functionName: role === "client" ? "jobsOfClient" : "jobsOfProvider", args: [who] }) as readonly bigint[];
    return Promise.all([...ids].reverse().map((id) => this.job(id)));
  }

  /** Public record of a provider: jobs completed, disputed, and USDG earned. */
  async record(provider: Address) {
    const [completed, disputed, earned] = await Promise.all((["completedOf", "disputedOf", "earnedOf"] as const).map((fn) =>
      this.client.readContract({ address: this.address, abi: heimdallPayAbi, functionName: fn, args: [provider] }) as Promise<bigint>));
    return { completed, disputed, earned };
  }

  /** Approves USDG if needed, then escrows the job. Returns the tx hash; the job id is in the JobCreated event. */
  async createJob(wallet: WalletClient, i: CreateJobInput): Promise<Hex> {
    const me = wallet.account!.address;
    const allowance = await this.client.readContract({ address: this.usdg, abi: ERC20, functionName: "allowance", args: [me, this.address] });
    if (allowance < i.amount) {
      const h = await wallet.writeContract({ address: this.usdg, abi: ERC20, functionName: "approve", args: [this.address, i.amount], chain: wallet.chain, account: wallet.account! });
      await this.client.waitForTransactionReceipt({ hash: h });
    }
    return wallet.writeContract({
      address: this.address, abi: heimdallPayAbi, functionName: "createJob", chain: wallet.chain, account: wallet.account!,
      args: [i.provider, i.arbiter ?? "0x0000000000000000000000000000000000000000", i.amount, i.deadline, i.reviewWindow ?? 86_400, i.arbiterFeeBps ?? 0, hashOf(i.spec)],
    });
  }

  /** USDG owed to `who` from payouts that could not be pushed (e.g. while the address was frozen). */
  owed(who: Address): Promise<bigint> {
    return this.client.readContract({ address: this.address, abi: heimdallPayAbi, functionName: "owed", args: [who] }) as Promise<bigint>;
  }

  private call(wallet: WalletClient, functionName: "submit" | "release" | "claim" | "refund" | "cancel" | "dispute" | "resolve" | "settleExpiredDispute" | "withdrawOwed", args: readonly unknown[]) {
    return wallet.writeContract({ address: this.address, abi: heimdallPayAbi, functionName, args: args as never, chain: wallet.chain, account: wallet.account! });
  }
  submit(wallet: WalletClient, id: bigint, result: string) { return this.call(wallet, "submit", [id, hashOf(result)]); }
  release(wallet: WalletClient, id: bigint) { return this.call(wallet, "release", [id]); }
  claim(wallet: WalletClient, id: bigint) { return this.call(wallet, "claim", [id]); }
  refund(wallet: WalletClient, id: bigint) { return this.call(wallet, "refund", [id]); }
  cancel(wallet: WalletClient, id: bigint) { return this.call(wallet, "cancel", [id]); }
  dispute(wallet: WalletClient, id: bigint, reason: string) { return this.call(wallet, "dispute", [id, reason]); }
  resolve(wallet: WalletClient, id: bigint, providerBps: number) { return this.call(wallet, "resolve", [id, providerBps]); }
  settleExpiredDispute(wallet: WalletClient, id: bigint) { return this.call(wallet, "settleExpiredDispute", [id]); }
  withdrawOwed(wallet: WalletClient) { return this.call(wallet, "withdrawOwed", []); }
}
