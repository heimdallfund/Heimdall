import { z } from "zod";
import { getAddress, isAddress, isHex, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import {
  HeimdallShield, HeimdallPay, HeimdallDenied, guardedSend,
  type CheckResult, type Policy, type SignatureCheckResult, type ShieldOptions,
} from "@heimdall/sdk";

/**
 * One framework-neutral definition per Heimdall tool. The AI SDK, LangChain and ElizaOS adapters wrap these, so every
 * framework gets the same names, descriptions, inputs and outputs.
 */
export interface HeimdallTool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  schema: S;
  /** true when the tool moves funds (only `heimdall_safe_send`). Adapters can ask a human first. */
  sendsFunds?: boolean;
  run(input: z.infer<S>): Promise<unknown>;
}

export interface AgentKitOptions extends ShieldOptions {
  /** An existing Shield client. Otherwise one is built from baseUrl / apiKey. */
  shield?: HeimdallShield;
  /** Policy applied to every transaction and signature check. */
  policy?: Policy;
  /** Robinhood Chain client, needed for the Heimdall Pay tools. */
  publicClient?: PublicClient;
  /** HeimdallPay contract. Pay tools are left out without it. */
  payAddress?: Address;
  /** The agent's wallet. Adds `heimdall_safe_send`, which only sends what Shield allows. */
  wallet?: WalletClient;
  /** Let `heimdall_safe_send` go ahead on WARN as well as ALLOW. Default false. */
  allowWarn?: boolean;
  /** Heimdall web app, for revoke links. Default https://heimdall.fund */
  siteUrl?: string;
  /** Pick a subset by name. Default: every tool the options above allow. */
  only?: string[];
}

const address = z.string().refine(isAddress, "a 0x-prefixed 20-byte address").describe("0x address on Robinhood Chain");
const hex = z.string().refine((v) => isHex(v), "0x-prefixed hex");
const wei = z.string().regex(/^\d+$/, "an integer in wei, as a string").describe("Amount of ETH in wei, as a decimal string");

/** Small, model-friendly view of a transaction check: what to do, why, and what moves. */
export function compactCheck(r: CheckResult | SignatureCheckResult) {
  const out: Record<string, unknown> = {
    verdict: r.verdict,
    riskScore: r.riskScore,
    summary: r.summary,
    findings: r.findings.filter((f) => f.severity !== "info").map((f) => `${f.severity.toUpperCase()} ${f.code}: ${f.message}`),
  };
  if ("assetChanges" in r) {
    out.assetChanges = r.assetChanges.map((c) => ({ symbol: c.symbol, delta: c.delta, decimals: c.decimals }));
    if (r.simulation.available && !r.simulation.ok) out.simulation = `reverts: ${r.simulation.revertReason ?? "unknown"}`;
    out.checkId = r.checkId;
  }
  if ("approvals" in r && r.approvals?.length) out.approvals = r.approvals;
  out.advice = r.verdict === "ALLOW" ? "Safe to sign." : r.verdict === "WARN" ? "Ask the user before signing." : "Do not sign or send this.";
  return out;
}

const json = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

export function heimdallTools(opts: AgentKitOptions = {}): HeimdallTool[] {
  const shield = opts.shield ?? new HeimdallShield(opts);
  const tools: HeimdallTool[] = [];
  const add = <S extends z.ZodObject>(t: HeimdallTool<S>) => { tools.push(t as unknown as HeimdallTool); };

  add({
    name: "heimdall_check_transaction",
    description: "Check a Robinhood Chain transaction with Heimdall Shield before signing it. Simulates it and returns ALLOW, WARN or DENY, the reasons, and which tokens would move. Never sign a DENY.",
    schema: z.object({
      from: address.describe("The wallet that would send it"),
      to: address.describe("Contract or recipient"),
      data: hex.optional().describe("Calldata, 0x-prefixed. Omit for a plain ETH transfer"),
      value: wei.optional(),
    }),
    run: async (i) => compactCheck(await shield.check({ chainId: 4663, from: getAddress(i.from), to: getAddress(i.to), data: i.data as Hex | undefined, value: i.value ?? "0" }, opts.policy)),
  });

  add({
    name: "heimdall_check_signature",
    description: "Check an off-chain signature request (EIP-712 typed data such as Permit or Permit2, or a personal_sign message) before signing it. Catches hidden approvals and drainer permits.",
    schema: z.object({
      signer: address.describe("The wallet asked to sign"),
      typedData: z.object({
        domain: z.record(z.string(), z.unknown()).optional(),
        types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))).optional(),
        primaryType: z.string(),
        message: z.record(z.string(), z.unknown()),
      }).optional().describe("EIP-712 payload"),
      message: z.string().optional().describe("Plain text for personal_sign"),
    }),
    run: async (i) => {
      if (!i.typedData && !i.message) throw new Error("give typedData or message");
      return compactCheck(await shield.checkSignature({ chainId: 4663, signer: getAddress(i.signer), typedData: i.typedData, message: i.message }, opts.policy));
    },
  });

  add({
    name: "heimdall_wallet_check",
    description: "List every token approval a wallet has given on Robinhood Chain, rated danger / review / ok, with the USD value each spender could take. Use it to find approvals to revoke.",
    schema: z.object({ address: address.describe("Wallet to scan") }),
    run: async (i) => {
      const r = await shield.walletCheck(getAddress(i.address));
      return {
        summary: r.summary,
        complete: r.complete,
        approvals: r.approvals.filter((a) => a.risk !== "ok").slice(0, 20).map((a) => ({
          risk: a.risk, token: a.symbol, spender: a.spenderLabel ?? a.spender, unlimited: a.unlimited, atRiskUsd: a.atRiskUsd, reasons: a.reasons,
        })),
        okCount: r.approvals.filter((a) => a.risk === "ok").length,
        revokeAt: `${opts.siteUrl ?? "https://heimdall.fund"}/check/${getAddress(i.address)}`,
      };
    },
  });

  add({
    name: "heimdall_agent_reputation",
    description: "How an agent wallet has behaved under Heimdall Shield: checks run and how many were allowed, warned or denied. Use it before trusting or paying another agent.",
    schema: z.object({ address: address.describe("Agent wallet") }),
    run: async (i) => json(await shield.agent(getAddress(i.address))),
  });

  add({
    name: "heimdall_passport",
    description: "Should I trust this agent? Heimdall Score (0-100) and tier for an agent wallet or ERC-8004 agentId, from its Shield history, Heimdall Pay record and Risk Oracle status, plus its ERC-8004 identity. Use before paying, hiring or depositing with another agent.",
    schema: z.object({ id: z.string().describe("0x wallet address or ERC-8004 agentId") }),
    run: async (i) => json(await shield.passport(/^0x/i.test(i.id) ? getAddress(i.id) : BigInt(i.id))),
  });

  add({
    name: "heimdall_risk",
    description: "Is this address a known drainer, phishing contract, exploiter or honeypot? Risk level (none, low, warn, blocked) with reasons, and what the onchain Heimdall Risk Oracle holds. Use before sending to, approving or trusting an address.",
    schema: z.object({ address: address.describe("Any Robinhood Chain address") }),
    run: async (i) => json(await shield.risk(getAddress(i.address))),
  });

  add({
    name: "heimdall_threats",
    description: "Current threat board: the contracts Shield denies most, the most common attack codes, and the community blocklist. Use it to avoid known bad addresses.",
    schema: z.object({}),
    run: async () => {
      const t = await shield.threats();
      return { window: t.window, topCodes: t.codes.slice(0, 8), topTargets: t.targets.slice(0, 10), blocklist: t.blocklist.slice(0, 25) };
    },
  });

  if (opts.publicClient && opts.payAddress) {
    const pay = new HeimdallPay(opts.payAddress, opts.publicClient);
    add({
      name: "heimdall_pay_job",
      description: "Read a Heimdall Pay escrow job: who pays whom, how much USDG is held, the deadline and its status (Open, Submitted, Disputed, Released, Refunded, Resolved).",
      schema: z.object({ id: z.string().regex(/^\d+$/).describe("Job id") }),
      run: async (i) => {
        const j = await pay.job(BigInt(i.id));
        return json({ ...j, amountUsdg: Number(j.amount) / 1e6 });
      },
    });
    add({
      name: "heimdall_pay_record",
      description: "Track record of an agent that does paid work through Heimdall Pay: jobs completed, jobs disputed and USDG earned. Use it before hiring an agent.",
      schema: z.object({ provider: address.describe("Provider agent wallet") }),
      run: async (i) => {
        const r = await pay.record(getAddress(i.provider));
        return { completed: Number(r.completed), disputed: Number(r.disputed), earnedUsdg: Number(r.earned) / 1e6 };
      },
    });
  }

  if (opts.wallet) {
    const wallet = opts.wallet;
    add({
      name: "heimdall_safe_send",
      description: "Send a transaction from the agent's wallet, but only after Heimdall Shield allows it. If Shield says no, nothing is sent and the reasons come back.",
      sendsFunds: true,
      schema: z.object({
        to: address.describe("Contract or recipient"),
        data: hex.optional().describe("Calldata, 0x-prefixed"),
        value: wei.optional(),
      }),
      run: async (i) => {
        try {
          const { hash, result } = await guardedSend(wallet, { to: getAddress(i.to), data: i.data as Hex | undefined, value: i.value ? BigInt(i.value) : undefined }, { shield, policy: opts.policy, allowWarn: opts.allowWarn });
          return { sent: true, hash, verdict: result.verdict };
        } catch (e) {
          if (e instanceof HeimdallDenied) return { sent: false, ...compactCheck(e.result) };
          throw e;
        }
      },
    });
  }

  return opts.only ? tools.filter((t) => opts.only!.includes(t.name)) : tools;
}
