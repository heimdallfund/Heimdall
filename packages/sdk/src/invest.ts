import { type Address, type Hex, type PublicClient, type WalletClient, parseAbi } from "viem";
import { heimdallAutoInvestAbi } from "./abi.js";

/** Auto-Invest: recurring stock-token buys with USDG, executed by a keeper within the user's oracle price bound. */
export interface Plan {
  id: bigint; owner: Address; token: Address; amountPerBuy: bigint; interval: number;
  maxSlippageBps: number; buysLeft: number; nextBuyAt: bigint; active: boolean;
  /** Protocol fee locked in when the plan was created (bps). */
  feeBps: number;
}
const ERC20 = parseAbi(["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);

export class HeimdallAutoInvest {
  constructor(readonly address: Address, readonly client: PublicClient, readonly usdg: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168") {}

  async plan(id: bigint): Promise<Plan> {
    const p = await this.client.readContract({ address: this.address, abi: heimdallAutoInvestAbi, functionName: "getPlan", args: [id] });
    return { id, ...(p as object) } as Plan;
  }
  async plansOf(owner: Address): Promise<Plan[]> {
    const ids = await this.client.readContract({ address: this.address, abi: heimdallAutoInvestAbi, functionName: "plansOf", args: [owner] }) as readonly bigint[];
    return Promise.all([...ids].reverse().map((id) => this.plan(id)));
  }
  /** Oracle price of one token in USDG raw units (0 while stale or paused). */
  oraclePrice(token: Address): Promise<bigint> {
    return this.client.readContract({ address: this.address, abi: heimdallAutoInvestAbi, functionName: "oraclePrice", args: [token] }) as Promise<bigint>;
  }

  /** Approves the whole budget (amountPerBuy × buys) if needed, then creates the plan. The first buy is due at once. */
  async createPlan(wallet: WalletClient, p: { token: Address; amountPerBuy: bigint; intervalSec: number; buys: number; maxSlippageBps?: number }): Promise<Hex> {
    const me = wallet.account!.address;
    const budget = p.amountPerBuy * BigInt(p.buys);
    const allowance = await this.client.readContract({ address: this.usdg, abi: ERC20, functionName: "allowance", args: [me, this.address] });
    if (allowance < budget) {
      const h = await wallet.writeContract({ address: this.usdg, abi: ERC20, functionName: "approve", args: [this.address, budget], chain: wallet.chain, account: wallet.account! });
      await this.client.waitForTransactionReceipt({ hash: h });
    }
    return wallet.writeContract({ address: this.address, abi: heimdallAutoInvestAbi, functionName: "createPlan", chain: wallet.chain, account: wallet.account!,
      args: [p.token, p.amountPerBuy, p.intervalSec, p.buys, p.maxSlippageBps ?? 100] });
  }
  cancelPlan(wallet: WalletClient, id: bigint) {
    return wallet.writeContract({ address: this.address, abi: heimdallAutoInvestAbi, functionName: "cancelPlan", args: [id], chain: wallet.chain, account: wallet.account! });
  }
  /** Keeper: execute a due buy (anyone may call). */
  execute(wallet: WalletClient, id: bigint) {
    return wallet.writeContract({ address: this.address, abi: heimdallAutoInvestAbi, functionName: "execute", args: [id], chain: wallet.chain, account: wallet.account! });
  }
}
