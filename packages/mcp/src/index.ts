#!/usr/bin/env node
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  createPublicClient, createWalletClient, encodeFunctionData, formatUnits, http, isAddress, isHash, maxUint256, parseAbi,
  type Address, type Hex, type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  payX402, readRisk,
  HeimdallShield, HeimdallPay, heimdallSignalsAbi, heimdallVaultAbi, heimdallVaultFactoryAbi, type Job,
  robinhoodChain, robinhoodChainTestnet, USDG, type CheckResult, type SignatureCheckResult,
  HEIMDALL_MAINNET,
} from "@heimdallfund/sdk";

export const VERSION = "0.2.0";

export interface Deps {
  shield: HeimdallShield;
  client: PublicClient;
  chainId: number;
  signals?: Address;
  factory?: Address;
  pay?: Address;
  riskOracle?: Address;
  webUrl: string;
}

const address = z.string().refine((v) => isAddress(v), "must be a 0x address");
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fail = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });
const msg = (e: unknown) => (e as Error).message.split("\n")[0];
const when = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export function formatCheck(r: Pick<CheckResult, "verdict" | "riskScore" | "summary" | "findings"> & { simulation?: CheckResult["simulation"] }, link?: string): string {
  const lines = [`Verdict: ${r.verdict} (risk ${r.riskScore}/100)`, ...r.summary.map((s) => `- ${s}`)];
  const notable = r.findings.filter((f) => f.severity !== "info");
  if (notable.length) lines.push("Findings:", ...notable.map((f) => `- [${f.severity.toUpperCase()}] ${f.message}`));
  if (r.simulation?.revertReason) lines.push(`Revert reason: ${r.simulation.revertReason}`);
  if (r.verdict === "DENY") lines.push("Do not sign this. Tell the user why, using the findings above.");
  else if (r.verdict === "WARN") lines.push("Only sign if the user confirms after reading the warnings.");
  if (link) lines.push(`Shareable result: ${link}`);
  return lines.join("\n");
}

export function buildServer(d: Deps) {
  const server = new McpServer({ name: "heimdall", version: VERSION }, {
    instructions:
      "Heimdall is a transaction and signature firewall for Robinhood Chain (chain 4663). " +
      "Before ANY transaction is sent, call heimdall_check_transaction. Before ANY signature request (EIP-712 typed data such as Permit, Permit2 or orders, or personal_sign), call heimdall_check_signature. " +
      "Never sign on DENY. On WARN, show the warnings and ask the user. If a check fails or times out, treat it as DENY.",
  });
  const verdictLink = (id?: string) => (id ? `${d.webUrl}/v/${id}` : undefined);

  server.registerTool("heimdall_check_transaction", {
    title: "Check a transaction before signing",
    description: "Simulate an EVM transaction on Robinhood Chain BEFORE signing it. Returns ALLOW, WARN or DENY with reasons: unlimited approvals, drainers, transfers to blocklisted addresses, reverts, spend limits. Call this before sending any transaction.",
    inputSchema: {
      from: address.describe("Wallet that will sign"),
      to: address.optional().describe("Target contract or recipient; omit for contract deployment"),
      data: hex.default("0x").describe("Calldata (hex)"),
      value: z.string().regex(/^\d+$/).default("0").describe("ETH value in wei"),
      maxNativeOutWei: z.string().regex(/^\d+$/).optional().describe("Optional per-transaction ETH cap"),
      strict: z.boolean().optional().describe("Treat WARN as DENY"),
      share: z.boolean().optional().describe("Save the verdict and return a public link"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ from, to, data, value, maxNativeOutWei, strict, share }) => {
    try {
      const r = await d.shield.check(
        { chainId: d.chainId, from: from as Address, to: (to as Address) ?? null, data: data as Hex, value },
        { strict, maxNativeOut: maxNativeOutWei }, { share },
      );
      return { ...text(formatCheck(r, verdictLink(r.shareId))), structuredContent: r as unknown as Record<string, unknown> };
    } catch (e) {
      return fail(`Shield check failed: ${msg(e)}. Treat the transaction as unsafe (DENY).`);
    }
  });

  server.registerTool("heimdall_check_signature", {
    title: "Check a signature request before signing",
    description: "Judge an EIP-712 typed-data request (Permit, Permit2, orders, Seaport, …), a personal_sign message, or an EIP-7702 authorization BEFORE signing. Gasless approvals and 7702 delegations are the most common ways agents get drained. Send exactly one of typedData, message or authorization.",
    inputSchema: {
      signer: address.describe("Wallet that would sign"),
      typedData: z.object({
        domain: z.record(z.string(), z.unknown()).optional(),
        types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))).optional(),
        primaryType: z.string(),
        message: z.record(z.string(), z.unknown()),
      }).optional().describe("The full eth_signTypedData_v4 payload"),
      message: z.string().max(16_384).optional().describe("A personal_sign message (plain text)"),
      authorization: z.object({ chainId: z.number().int().nonnegative(), address: address, nonce: z.number().int().nonnegative().optional() }).optional().describe("An EIP-7702 authorization the wallet is asked to sign: which contract it would delegate to"),
      share: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ signer, typedData, message, authorization, share }) => {
    if ([typedData, message, authorization].filter((x) => x !== undefined).length !== 1) return fail("Send exactly one of typedData, message or authorization.");
    try {
      const r: SignatureCheckResult = await d.shield.checkSignature({ chainId: d.chainId, signer: signer as Address, typedData, message, authorization: authorization as never }, undefined, { share });
      const extra = r.approvals?.length
        ? `\nGrants spending rights to: ${r.approvals.map((a) => `${a.spender}${a.unlimited ? " (unlimited)" : ""}`).join(", ")}`
        : "";
      return { ...text(formatCheck(r, verdictLink(r.shareId)) + extra), structuredContent: r as unknown as Record<string, unknown> };
    } catch (e) {
      return fail(`Signature check failed: ${msg(e)}. Do not sign (treat as DENY).`);
    }
  });

  server.registerTool("heimdall_check_address", {
    title: "Is this address safe to approve or pay?",
    description: "Check a spender, contract or recipient before trusting it: blocklist status, how often Shield denied it in the last 7 days, and a simulated unlimited USDG approval to it.",
    inputSchema: { address: address.describe("The address to vet") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ address: a }) => {
    const target = a as Address;
    const probe = privateKeyToAccount(generatePrivateKey()).address; // throwaway wallet: nothing real is approved
    const data = encodeFunctionData({ abi: parseAbi(["function approve(address,uint256)"]), functionName: "approve", args: [target, maxUint256] });
    const [code, board, check] = await Promise.allSettled([
      d.client.getCode({ address: target }),
      d.shield.threats(),
      d.shield.check({ chainId: d.chainId, from: probe, to: USDG, data }, undefined, { probe: true }),
    ]);
    const lines = [`Address ${target}`];
    if (code.status === "fulfilled") lines.push(`Type: ${(code.value ?? "0x").length > 2 ? "contract" : "wallet (EOA): approving a wallet is how drainers work"}`);
    if (board.status === "fulfilled") {
      const bl = board.value.blocklist.find((b) => b.address.toLowerCase() === target.toLowerCase());
      const t = board.value.targets.find((x) => x.address.toLowerCase() === target.toLowerCase());
      lines.push(bl ? `BLOCKLISTED${bl.label ? `: ${bl.label}` : ""}${bl.reason ? ` (${bl.reason})` : ""}` : "Not on the blocklist");
      lines.push(t ? `Denied ${t.denies} time(s) by Shield in the last ${board.value.window}` : `No Shield denials in the last ${board.value.window}`);
    }
    if (check.status === "fulfilled") lines.push(`Simulated unlimited USDG approval → ${check.value.verdict}${check.value.findings.filter((f) => f.severity === "deny").map((f) => `: ${f.message}`).join("")}`);
    else lines.push(`Approval simulation unavailable (${msg(check.reason)})`);
    return text(lines.join("\n"));
  });

  server.registerTool("heimdall_token_check", {
    title: "Is this token safe to buy?",
    description: "Before buying a token on Robinhood Chain: simulates a buy, a sell and a transfer through its Uniswap pool, measures buy/sell/transfer taxes, tests whether anyone or the owner can pull it out of a holder's wallet (clawback), and checks for fake tickers (a copy of USDG, NVDA…) and the blocklist. Never buy on DENY.",
    inputSchema: { token: address.describe("Token contract address") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ token }) => {
    try {
      const r = await d.shield.tokenCheck(token as Address);
      const leg = (n: string, l: { ok: boolean; taxPct: number | null; reason?: string } | null) => `${n}: ${l === null ? "not simulated" : !l.ok ? `FAILS${l.reason ? ` (${l.reason})` : ""}` : l.taxPct ? `${l.taxPct}% tax` : "ok"}`;
      const lines = [
        `${r.symbol ?? "Unknown"}${r.name ? ` (${r.name})` : ""} ${r.token}`,
        `Verdict: ${r.verdict} (risk ${r.riskScore}/100)`,
        [leg("Buy", r.buy), leg("Sell", r.sell), leg("Transfer", r.transfer)].join(" · "),
        r.pullableBy.length ? `Clawback: ${r.pullableBy.join(" and ")} can take it from a holder's wallet` : "Clawback: none found",
        ...r.findings.filter((f) => f.severity !== "info").map((f) => `- [${f.severity.toUpperCase()}] ${f.message}`),
        `Report: ${d.webUrl}/token-check/${r.token}`,
      ];
      if (r.verdict === "DENY") lines.push("Do not buy this token.");
      return { ...text(lines.join("\n")), structuredContent: r as unknown as Record<string, unknown> };
    } catch (e) {
      return fail(`Token Check failed: ${msg(e)}. Treat the token as unsafe.`);
    }
  });

  server.registerTool("heimdall_wallet_check", {
    title: "Wallet Check: risky approvals",
    description: "List every live token approval of a wallet on Robinhood Chain, ranked danger / review / ok, with the USD value each one exposes. Use it before trusting a wallet, or to tell a user what to revoke.",
    inputSchema: { address: address.describe("Wallet to check") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ address: a }) => {
    try {
      const r = await d.shield.walletCheck(a as Address);
      const lines = [`Wallet ${a}: ${r.summary.total} live approval(s), ${r.summary.danger} dangerous, ${r.summary.review} to review, $${r.summary.atRiskUsd.toLocaleString("en-US")} at risk.`];
      for (const x of r.approvals.filter((x) => x.risk !== "ok").slice(0, 10))
        lines.push(`- [${x.risk.toUpperCase()}] ${x.symbol} ${x.allowance} → ${x.spenderLabel ?? x.spender}${x.atRiskUsd ? ` ($${x.atRiskUsd} exposed)` : ""}: ${x.reasons[0] ?? ""}`);
      if (!r.complete) lines.push(`History scan ${r.progress}% done; call again to continue.`);
      if (r.summary.danger + r.summary.review) lines.push(`Revoke them at ${d.webUrl}/check/${a}`);
      return { ...text(lines.join("\n")), structuredContent: r as unknown as Record<string, unknown> };
    } catch (e) {
      return fail(`Wallet Check failed: ${msg(e)}`);
    }
  });

  server.registerTool("heimdall_check_tx_hash", {
    title: "Check a transaction by hash",
    description: "Look up a pending or mined transaction on Robinhood Chain by hash and judge it with Shield (useful for a tx someone sent you to sign or that already happened).",
    inputSchema: { hash: z.string().refine((v) => isHash(v), "must be a 32-byte 0x hash"), share: z.boolean().optional() },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ hash, share }) => {
    try {
      const tx = await d.client.getTransaction({ hash: hash as Hex });
      const r = await d.shield.check({ chainId: d.chainId, from: tx.from, to: tx.to ?? null, data: tx.input, value: tx.value.toString() }, undefined, { share });
      return text(`Transaction ${hash} from ${tx.from} to ${tx.to ?? "(deploy)"}${tx.blockNumber ? ` (mined in block ${tx.blockNumber})` : " (pending)"}\n` + formatCheck(r, verdictLink(r.shareId)));
    } catch (e) {
      return fail(`Could not check ${hash}: ${msg(e)}`);
    }
  });

  server.registerTool("heimdall_threats", {
    title: "Threat Board",
    description: "What Shield is blocking right now on Robinhood Chain: top threat patterns, most-denied addresses and recent denials (last 7 days).",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async () => {
    try {
      const b = await d.shield.threats();
      const lines = [`Threat Board (${b.window})`];
      lines.push("Patterns:", ...(b.codes.length ? b.codes.slice(0, 8).map((c) => `- ${c.code}: ${c.count}`) : ["- none"]));
      lines.push("Most-denied addresses:", ...(b.targets.length ? b.targets.slice(0, 8).map((t) => `- ${t.address}: ${t.denies}${t.blocklisted ? " (blocklisted)" : ""}`) : ["- none"]));
      lines.push("Recent denials:", ...(b.recent.length ? b.recent.slice(0, 8).map((r) => `- ${when(r.at)} · ${r.kind} · ${r.summary || r.codes.join(", ")}`) : ["- none"]));
      return { ...text(lines.join("\n")), structuredContent: b as unknown as Record<string, unknown> };
    } catch (e) {
      return fail(`Threat Board unavailable: ${msg(e)}`);
    }
  });

  server.registerTool("heimdall_agent_reputation", {
    title: "Agent reputation",
    description: "Public Shield history of an agent wallet: how many transactions it checked, and how many were allowed, warned or denied.",
    inputSchema: { address },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ address: a }) => {
    try {
      const s = await d.shield.agent(a as Address);
      if (!s.checks) return text(`${a} has no Shield history yet.`);
      const rate = ((s.denied / s.checks) * 100).toFixed(1);
      return text([
        `Agent ${a}`,
        `Checks: ${s.checks} · allowed ${s.allowed} · warned ${s.warned} · denied ${s.denied} (${rate}% denied)`,
        s.firstSeen ? `First seen ${when(s.firstSeen)}, last seen ${when(s.lastSeen ?? s.firstSeen)}` : "",
        `Profile: ${d.webUrl}/agent/${a}`,
      ].filter(Boolean).join("\n"));
    } catch (e) {
      return fail(`Could not load agent: ${msg(e)}`);
    }
  });

  server.registerTool("heimdall_risk", {
    title: "Risk of an address",
    description: "Is this address a known drainer, phishing contract, exploiter or honeypot? Returns Heimdall's risk level (none, low, warn, blocked), the reasons, and what the onchain Heimdall Risk Oracle holds. Use before sending to, approving or trusting an address.",
    inputSchema: { address },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ address: a }) => {
    try {
      const r = await d.shield.risk(a as Address);
      const onchain = r.onchain ?? (d.riskOracle ? await readRisk(d.client, d.riskOracle, a as Address).then((x) => ({ level: x.level, flags: 0, flagNames: x.flags, updatedAt: x.updatedAt ? new Date(x.updatedAt * 1000).toISOString() : null })).catch(() => null) : null);
      return text([
        `${a}: ${r.levelName.toUpperCase()}${r.flagNames.length ? ` (${r.flagNames.join(", ")})` : ""}`,
        r.label ? `Reason: ${r.label}` : r.level === 0 ? "No risk data: not on Heimdall's lists. That is not a guarantee; check the transaction itself with heimdall_check_transaction." : "",
        onchain ? `Onchain oracle: level ${onchain.level}${onchain.updatedAt ? `, updated ${onchain.updatedAt}` : ""}` : "",
        r.blocked ? "Do not send funds to, approve, or sign for this address." : "",
      ].filter(Boolean).join("\n"));
    } catch (e) {
      return fail(`Could not load risk: ${msg(e)}`);
    }
  });

  server.registerTool("heimdall_passport", {
    title: "Agent Passport",
    description: "Should I trust this agent? Heimdall Score (0-100) and tier for an agent wallet or ERC-8004 agentId, built from its Shield history, Heimdall Pay record and Risk Oracle status, plus its ERC-8004 identity and onchain reputation. Use before paying, hiring or depositing with another agent.",
    inputSchema: { id: z.string().describe("0x wallet address or ERC-8004 agentId") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ id }) => {
    try {
      const p = await d.shield.passport((isAddress(id) ? id : BigInt(id)) as Address);
      const name = p.identity?.registration?.name;
      return text([
        `${name ? `${name} · ` : ""}${p.address}${p.agentId !== null ? ` · ERC-8004 agent #${p.agentId}` : ""}`,
        p.score === null ? "Heimdall Score: not enough history yet (new agent)." : `Heimdall Score: ${p.score}/100 · tier ${p.tier}${p.capped ? ` (capped: ${p.capped})` : ""}`,
        ...p.components.map((c) => `- ${c.name}: ${c.score}/100 (weight ${c.weight}) · ${c.detail}`),
        p.risk.blocked ? "BLOCKED: on Heimdall's blocklist. Do not pay or trust this agent." : "",
        p.reputation?.count ? `Onchain: ${p.reputation.count} Heimdall rating(s) on the ERC-8004 Reputation Registry, average ${p.reputation.average}` : "",
        `Passport: ${d.webUrl}/agent/${p.address}`,
      ].filter(Boolean).join("\n"));
    } catch (e) {
      return fail(`Could not load passport: ${msg(e)}`);
    }
  });

  server.registerTool("heimdall_get_verdict", {
    title: "Open a shared verdict",
    description: "Read a verdict that was saved with share:true, by its id (from a heimdall /v/<id> link).",
    inputSchema: { id: z.string().refine((v) => isHash(v), "must be a 32-byte 0x id") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ id }) => {
    try {
      const v = await d.shield.verdict(id as Hex);
      return text(`${v.kind === "sig" ? "Signature" : "Transaction"} checked ${when(v.at)}\n` + formatCheck(v.result as CheckResult, verdictLink(id)));
    } catch (e) {
      return fail(`Verdict not found or expired: ${msg(e)}`);
    }
  });

  server.registerTool("heimdall_list_signals", {
    title: "List Heimdall Signals",
    description: "List pay-per-call data signals on Heimdall Signals: id, price per call (USDG), provider, metadata.",
    inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
    annotations: { readOnlyHint: true },
  }, async ({ limit }) => {
    if (!d.signals) return fail("HEIMDALL_SIGNALS_ADDRESS is not configured.");
    try {
      const count = await d.client.readContract({ address: d.signals, abi: heimdallSignalsAbi, functionName: "signalCount" });
      const n = Number(count < BigInt(limit) ? count : BigInt(limit));
      const rows = await Promise.all(Array.from({ length: n }, (_, i) =>
        d.client.readContract({ address: d.signals!, abi: heimdallSignalsAbi, functionName: "getSignal", args: [BigInt(i)] })));
      if (!rows.length) return text("No signals registered yet.");
      return text(rows.map((s, i) => `#${i} ${s.active ? "" : "(inactive) "}${formatUnits(s.pricePerCall, 6)} USDG/call · provider ${s.provider} · ${s.uri}`).join("\n"));
    } catch (e) {
      return fail(`Could not read signals: ${msg(e)}`);
    }
  });

  server.registerTool("heimdall_vault_info", {
    title: "Heimdall vault info",
    description: "Read a Heimdall vault: NAV, share price, manager, onchain loss limits (worst case per 1,000 USDG deposited) and tracked assets.",
    inputSchema: { vault: address },
    annotations: { readOnlyHint: true },
  }, async ({ vault }) => {
    const v = vault as Address;
    const read = <T,>(functionName: string, args: unknown[] = []) =>
      d.client.readContract({ address: v, abi: heimdallVaultAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
    try {
      const [name, symbol, decimals, manager, tradeBps, lossBps, assets] = await Promise.all([
        read<string>("name"), read<string>("symbol"), read<number>("decimals"), read<Address>("manager"),
        read<number>("maxTradeBps"), read<number>("maxLossBps"), read<Address[]>("trackedAssets"),
      ]);
      const dailyBps = await read<number>("maxDailyLossBps").catch(() => undefined);
      const nav = await read<bigint>("totalAssets").catch(() => undefined);
      const pps = await read<bigint>("convertToAssets", [10n ** BigInt(decimals)]).catch(() => undefined);
      const per1k = (bps: number) => (1000 * bps / 10_000).toFixed(2);
      return text([
        `${name} (${symbol})`,
        `NAV: ${nav === undefined ? "unavailable (price feed stale or paused, in-kind exit still works)" : `${formatUnits(nav, 6)} USDG`}`,
        `Share price: ${pps === undefined ? "unavailable" : `${formatUnits(pps, 6)} USDG`}`,
        `Manager: ${manager}`,
        `Limits: ${tradeBps / 100}% of NAV per trade, max ${lossBps / 100}% loss per trade${dailyBps === undefined ? "" : `, max ${dailyBps / 100}% loss per 24h`}`,
        `Worst case per 1,000 USDG: ${per1k(lossBps)} USDG per bad trade${dailyBps === undefined ? "" : `, ${per1k(dailyBps)} USDG per day`}; the manager can withdraw 0.`,
        `Tracked assets: ${assets.join(", ") || "none"}`,
        `Page: ${d.webUrl}/vaults/${v}`,
      ].join("\n"));
    } catch (e) {
      return fail(`Could not read vault: ${msg(e)}`);
    }
  });

  server.registerTool("heimdall_list_vaults", {
    title: "List Heimdall vaults",
    description: "List vaults created through the Heimdall vault factory.",
    inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
    annotations: { readOnlyHint: true },
  }, async ({ limit }) => {
    if (!d.factory) return fail("HEIMDALL_FACTORY_ADDRESS is not configured.");
    try {
      const count = await d.client.readContract({ address: d.factory, abi: heimdallVaultFactoryAbi, functionName: "vaultCount" });
      const n = Number(count < BigInt(limit) ? count : BigInt(limit));
      const vaults = await Promise.all(Array.from({ length: n }, (_, i) =>
        d.client.readContract({ address: d.factory!, abi: heimdallVaultFactoryAbi, functionName: "allVaults", args: [BigInt(i)] })));
      return text(vaults.length ? vaults.map((v, i) => `#${i} ${v}`).join("\n") : "No vaults yet.");
    } catch (e) {
      return fail(`Could not read vaults: ${msg(e)}`);
    }
  });

  const jobLine = (j: Job) => `#${j.id} ${j.status} · ${formatUnits(j.amount, 6)} USDG · client ${j.client} → provider ${j.provider}` +
    (j.status === "Open" ? ` · deadline ${when(Number(j.deadline) * 1000)}` : "") +
    (j.status === "Submitted" ? ` · auto-release ${when((Number(j.submittedAt) + j.reviewWindow) * 1000)}` : "");

  server.registerTool("heimdall_pay_jobs", {
    title: "Heimdall Pay: jobs of an agent",
    description: "List USDG escrow jobs on Heimdall Pay where an address is the client (who pays) or the provider (who does the work), newest first, with status and deadlines.",
    inputSchema: { address, role: z.enum(["client", "provider"]).default("provider"), limit: z.number().int().min(1).max(50).default(10) },
    annotations: { readOnlyHint: true },
  }, async ({ address: a, role, limit }) => {
    if (!d.pay) return fail("HEIMDALL_PAY_ADDRESS is not configured.");
    try {
      const pay = new HeimdallPay(d.pay, d.client);
      const [jobs, rec] = await Promise.all([pay.jobsOf(a as Address, role), pay.record(a as Address)]);
      const head = `Provider record of ${a}: ${rec.completed} completed, ${rec.disputed} disputed, ${formatUnits(rec.earned, 6)} USDG earned.`;
      return text([head, ...(jobs.length ? jobs.slice(0, limit).map(jobLine) : [`No jobs as ${role}.`])].join("\n"));
    } catch (e) {
      return fail(`Could not read Heimdall Pay: ${msg(e)}`);
    }
  });

  server.registerTool("heimdall_pay_job", {
    title: "Heimdall Pay: one job",
    description: "Read one Heimdall Pay escrow job: amount, parties, arbiter, status, deadline, review window and result hash. Use it before doing paid work for another agent, or before releasing payment.",
    inputSchema: { id: z.number().int().min(0) },
    annotations: { readOnlyHint: true },
  }, async ({ id }) => {
    if (!d.pay) return fail("HEIMDALL_PAY_ADDRESS is not configured.");
    try {
      const j = await new HeimdallPay(d.pay, d.client).job(BigInt(id));
      if (j.status === "None") return fail(`Job #${id} does not exist.`);
      return text([
        jobLine(j),
        `Arbiter: ${/^0x0{40}$/.test(j.arbiter) ? "none (no disputes)" : `${j.arbiter} (fee ${j.arbiterFeeBps / 100}%)`} · protocol fee ${j.feeBps / 100}%`,
        `Review window: ${j.reviewWindow / 3600} h · spec ${j.specHash}${j.status !== "Open" ? ` · result ${j.resultHash}` : ""}`,
        `Page: ${d.webUrl}/pay/job/${id}`,
      ].join("\n"));
    } catch (e) {
      return fail(`Could not read job: ${msg(e)}`);
    }
  });

  server.registerTool("heimdall_arena", {
    title: "Agent Arena standings",
    description: "Current Agent Arena season: AI-managed Heimdall vaults ranked by share-price return, with worst drawdown, TVL and depositors.",
    inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ limit }) => {
    try {
      const a = await d.shield.arena();
      if (!a.season) return text("No Agent Arena season is scheduled yet.");
      const s = a.season;
      const lines = [`${s.name}: ${when(s.start)} → ${when(s.end)}${s.prize ? ` · prize: ${s.prize}` : ""}`];
      const rows = a.standings.slice(0, limit);
      lines.push(...(rows.length ? rows.map((r) => `${r.rank ? `#${r.rank}` : "—"} ${r.name} (${r.vault}) · ${r.returnPct >= 0 ? "+" : ""}${r.returnPct}% · worst drop −${r.maxDrawdownPct}% · ${r.tvl} USDG · ${r.depositors} depositors${r.eligible ? "" : ` · not ranked: ${r.reason}`}`) : ["No vaults on the board yet."]));
      lines.push(`Board: ${d.webUrl}/arena`);
      return { ...text(lines.join("\n")), structuredContent: a as unknown as Record<string, unknown> };
    } catch (e) {
      return fail(`Arena unavailable: ${msg(e)}`);
    }
  });

  server.registerPrompt("safe_send", {
    title: "Send a transaction safely",
    description: "Walk through checking a transaction with Heimdall Shield before it is signed.",
    argsSchema: { goal: z.string().describe("What the user wants to do, e.g. 'swap 100 USDG for NVDA'") },
  }, ({ goal }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `I want to: ${goal}\n\nBuild the transaction, then call heimdall_check_transaction with it before anything is signed. ` +
          "If it needs a token approval, check the approval transaction too and prefer an exact amount over unlimited. " +
          "If the dapp asks for a signature instead (Permit, Permit2, an order), call heimdall_check_signature with the full typed data. " +
          "Show me the verdict and the reasons in plain language. Do not sign on DENY; on WARN, ask me first.",
      },
    }],
  }));

  return server;
}

export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): Deps {
  const chain = env.HEIMDALL_CHAIN === "testnet" ? robinhoodChainTestnet : robinhoodChain;
  const main = chain.id === HEIMDALL_MAINNET.chainId;
  // Keyless: with HEIMDALL_X402_PRIVATE_KEY the server pays per call in USDG (x402) once the free limit is used,
  // never more than HEIMDALL_X402_MAX raw units (default 0.005 USDG) per call. The wallet needs USDG only, no ETH.
  let fetchImpl: typeof fetch | undefined;
  if (env.HEIMDALL_X402_PRIVATE_KEY) {
    const wallet = createWalletClient({ account: privateKeyToAccount(env.HEIMDALL_X402_PRIVATE_KEY as Hex), chain, transport: http(env.RPC_URL) });
    fetchImpl = payX402(fetch, wallet, { maxAmount: BigInt(env.HEIMDALL_X402_MAX ?? "5000") });
  }
  return {
    shield: new HeimdallShield({ baseUrl: env.HEIMDALL_API_URL, apiKey: env.HEIMDALL_API_KEY, fetch: fetchImpl }),
    client: createPublicClient({ chain, transport: http(env.RPC_URL) }) as PublicClient,
    chainId: chain.id,
    // mainnet defaults; on testnet the addresses must come from the environment
    signals: (env.HEIMDALL_SIGNALS_ADDRESS ?? (main ? HEIMDALL_MAINNET.signals : undefined)) as Address | undefined,
    factory: (env.HEIMDALL_FACTORY_ADDRESS ?? (main ? HEIMDALL_MAINNET.vaultFactory : undefined)) as Address | undefined,
    pay: (env.HEIMDALL_PAY_ADDRESS ?? (main ? HEIMDALL_MAINNET.pay : undefined)) as Address | undefined,
    riskOracle: (env.HEIMDALL_RISK_ORACLE_ADDRESS ?? (main ? HEIMDALL_MAINNET.riskOracle : undefined)) as Address | undefined,
    webUrl: (env.HEIMDALL_WEB_URL ?? "https://heimdall.fund").replace(/\/$/, ""),
  };
}

/** Remote mode: stateless Streamable HTTP on POST /mcp, one server per request. */
export function startHttp(port: number, deps: Deps) {
  const srv = createServer(async (req, res) => {
    if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, version: VERSION })); return; }
    if (!req.url?.startsWith("/mcp")) { res.writeHead(404).end(); return; }
    if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }).end(); return; }
    const server = buildServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
  srv.listen(port);
  return srv;
}

const invoked = process.argv[1] && (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith("heimdall-mcp"));
if (invoked) {
  const i = process.argv.indexOf("--http");
  if (i > -1) {
    const port = Number(process.argv[i + 1] ?? process.env.PORT ?? 3333);
    startHttp(port, depsFromEnv());
    console.error(`heimdall-mcp ${VERSION} listening on http://localhost:${port}/mcp`);
  } else {
    await buildServer(depsFromEnv()).connect(new StdioServerTransport());
  }
}
