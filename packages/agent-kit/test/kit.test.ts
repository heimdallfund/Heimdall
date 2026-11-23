import { describe, it, expect, vi } from "vitest";
import { generateText, isStepCount } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { HeimdallShield } from "@heimdallfund/sdk";
import { heimdallTools } from "../src/index.js";
import { heimdallAiTools } from "../src/ai-sdk.js";
import { heimdallLangChainTools } from "../src/langchain.js";
import { heimdallPlugin } from "../src/eliza.js";

const AGENT = "0x1111111111111111111111111111111111111111";
const DRAINER = "0x3333333333333333333333333333333333333333";
const ROUTER = "0xCaf681a6b0F1b8c26B1D2B9dDAa1C4D16a49E7D9";

function check(verdict: "ALLOW" | "WARN" | "DENY") {
  return {
    checkId: "0xab", verdict, riskScore: verdict === "DENY" ? 95 : 5,
    summary: [verdict === "DENY" ? "Approves an unlimited amount of USDG to an unknown contract" : "Swap 10 USDG for NVDA"],
    findings: verdict === "DENY" ? [{ code: "UNLIMITED_APPROVAL_UNKNOWN", severity: "deny", message: "Unlimited approval to an unverified contract" }, { code: "INFO", severity: "info", message: "noise" }] : [],
    approvals: [], assetChanges: [{ asset: ROUTER, symbol: "USDG", decimals: 6, kind: "erc20", delta: "-10000000", counterparties: [] }],
    simulation: { ok: true, available: true },
  };
}

function fakeShield() {
  const calls: { path: string; body?: unknown }[] = [];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    let out: unknown;
    if (path === "/v1/check") out = check(body.to.toLowerCase() === DRAINER ? "DENY" : "ALLOW");
    else if (path === "/v1/check-signature") out = { verdict: "DENY", riskScore: 90, summary: ["Permit2 for all USDG"], findings: [{ code: "PERMIT2_UNLIMITED", severity: "deny", message: "x" }], approvals: [{ spender: DRAINER, unlimited: true }] };
    else if (path.startsWith("/v1/wallet/")) out = { owner: AGENT, block: "1", scannedAt: 0, complete: true, progress: 1, sources: [], summary: { total: 2, danger: 1, review: 0, atRiskUsd: 2500 }, approvals: [
      { risk: "danger", symbol: "USDG", spender: DRAINER, spenderLabel: null, unlimited: true, atRiskUsd: 2500, reasons: ["unverified"] },
      { risk: "ok", symbol: "USDG", spender: ROUTER, spenderLabel: "Uniswap Router", unlimited: false, atRiskUsd: 10, reasons: [] }] };
    else if (path.startsWith("/v1/agents/")) out = { address: AGENT, checks: 10, allowed: 9, warned: 1, denied: 0, firstSeen: 1, lastSeen: 2 };
    else if (path === "/v1/threats") out = { window: "24h", codes: [], targets: [], recent: [], blocklist: [{ address: DRAINER, label: "drainer" }] };
    else return new Response("nope", { status: 404 });
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { shield: new HeimdallShield({ baseUrl: "https://shield.test", fetch: f as unknown as typeof fetch }), calls };
}

function fakeWallet() {
  return { account: { address: AGENT, type: "json-rpc" }, chain: { id: 4663 }, sendTransaction: vi.fn(async () => "0xfeed") } as never as import("viem").WalletClient & { sendTransaction: ReturnType<typeof vi.fn> };
}

describe("core tools", () => {
  it("exposes read-only tools by default and adds safe_send only with a wallet", () => {
    const { shield } = fakeShield();
    expect(heimdallTools({ shield }).map((t) => t.name)).toEqual(["heimdall_check_transaction", "heimdall_check_signature", "heimdall_wallet_check", "heimdall_agent_reputation", "heimdall_passport", "heimdall_risk", "heimdall_threats"]);
    const withWallet = heimdallTools({ shield, wallet: fakeWallet() });
    expect(withWallet.find((t) => t.name === "heimdall_safe_send")?.sendsFunds).toBe(true);
    expect(heimdallTools({ shield, only: ["heimdall_threats"] })).toHaveLength(1);
  });

  it("returns a compact verdict without info-level noise", async () => {
    const { shield } = fakeShield();
    const t = heimdallTools({ shield }).find((x) => x.name === "heimdall_check_transaction")!;
    const r = await t.run({ from: AGENT, to: DRAINER, data: "0x095ea7b3" }) as Record<string, unknown>;
    expect(r.verdict).toBe("DENY");
    expect(r.findings).toEqual(["DENY UNLIMITED_APPROVAL_UNKNOWN: Unlimited approval to an unverified contract"]);
    expect(r.advice).toBe("Do not sign or send this.");
  });

  it("wallet check keeps only risky approvals and links to revoke", async () => {
    const { shield } = fakeShield();
    const t = heimdallTools({ shield, siteUrl: "https://example.org" }).find((x) => x.name === "heimdall_wallet_check")!;
    const r = await t.run({ address: AGENT }) as { approvals: unknown[]; okCount: number; revokeAt: string };
    expect(r.approvals).toHaveLength(1);
    expect(r.okCount).toBe(1);
    expect(r.revokeAt).toBe(`https://example.org/check/${AGENT}`);
  });

  it("safe_send sends on ALLOW and refuses on DENY without touching the wallet", async () => {
    const { shield } = fakeShield();
    const wallet = fakeWallet();
    const send = heimdallTools({ shield, wallet }).find((x) => x.name === "heimdall_safe_send")!;
    expect(await send.run({ to: DRAINER, data: "0x095ea7b3" })).toMatchObject({ sent: false, verdict: "DENY" });
    expect(wallet.sendTransaction).not.toHaveBeenCalled();
    expect(await send.run({ to: ROUTER, data: "0x04e45aaf" })).toEqual({ sent: true, hash: "0xfeed", verdict: "ALLOW" });
    expect(wallet.sendTransaction).toHaveBeenCalledTimes(1);
  });
});

describe("Vercel AI SDK", () => {
  it("a model calls the tool and reads the verdict", async () => {
    const { shield, calls } = fakeShield();
    let step = 0;
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
    const model = new MockLanguageModelV4({
      doGenerate: async () => (step++ === 0
        ? { content: [{ type: "tool-call", toolCallId: "c1", toolName: "heimdall_check_transaction", input: JSON.stringify({ from: AGENT, to: DRAINER, data: "0x095ea7b3" }) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] }
        : { content: [{ type: "text", text: "Blocked: this is a drainer." }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] }) as never,
    });
    const res = await generateText({ model, tools: heimdallAiTools({ shield }), prompt: "approve this", stopWhen: isStepCount(3) });
    expect(calls.map((c) => c.path)).toEqual(["/v1/check"]);
    const result = res.steps[0].toolResults[0] as { output: { verdict: string } };
    expect(result.output.verdict).toBe("DENY");
    expect(res.text).toBe("Blocked: this is a drainer.");
  });

  it("marks safe_send as needing approval by default", () => {
    const { shield } = fakeShield();
    const set = heimdallAiTools({ shield, wallet: fakeWallet() });
    expect(set.heimdall_safe_send.needsApproval).toBe(true);
    expect(set.heimdall_check_transaction.needsApproval).toBe(false);
    expect(heimdallAiTools({ shield, wallet: fakeWallet(), approveSends: false }).heimdall_safe_send.needsApproval).toBe(false);
  });
});

describe("LangChain", () => {
  it("tools validate input and return JSON text", async () => {
    const { shield } = fakeShield();
    const tools = heimdallLangChainTools({ shield });
    const sig = tools.find((t) => t.name === "heimdall_check_signature")!;
    const out = JSON.parse(await sig.invoke({ signer: AGENT, typedData: { primaryType: "PermitSingle", message: { spender: DRAINER } } }) as string);
    expect(out.verdict).toBe("DENY");
    await expect(tools.find((t) => t.name === "heimdall_wallet_check")!.invoke({ address: "not-an-address" })).rejects.toThrow();
  });
});

describe("ElizaOS", () => {
  it("plugin actions take structured parameters and report back", async () => {
    const { shield } = fakeShield();
    const plugin = heimdallPlugin({ shield });
    const action = plugin.actions!.find((a) => a.name === "HEIMDALL_AGENT_REPUTATION")!;
    expect(action.parameters?.[0]).toMatchObject({ name: "address", required: true });
    const callback = vi.fn(async () => []);
    const res = await action.handler({} as never, {} as never, undefined, { parameters: { address: AGENT } }, callback);
    expect(res).toMatchObject({ success: true });
    expect(JSON.parse(res.text!)).toMatchObject({ checks: 10, denied: 0 });
    expect(callback).toHaveBeenCalledOnce();
    const bad = await action.handler({} as never, {} as never, undefined, { parameters: { address: "0x12" } });
    expect(bad.success).toBe(false);
  });

  it("init reads settings from the runtime", async () => {
    const plugin = heimdallPlugin();
    const runtime = { getSetting: (k: string) => ({ HEIMDALL_API_URL: "https://shield.example", HEIMDALL_PAY_ADDRESS: "0x2222222222222222222222222222222222222222" } as Record<string, string>)[k] ?? null };
    await plugin.init!({}, runtime as never);
    // Pay tools need a public client too, so they stay off; the Shield tools are rebuilt.
    expect(plugin.actions!.map((a) => a.name)).toContain("HEIMDALL_CHECK_TRANSACTION");
  });
});
