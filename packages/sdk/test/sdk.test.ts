import { describe, expect, it } from "vitest";
import { createWalletClient, encodeFunctionData, http, maxUint256, parseAbi, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  HeimdallShield, HeimdallDenied, guardedSend, receiptArgs, signVoucher, verifyVoucher,
  encodeVoucherHeader, decodeVoucherHeader, robinhoodChain,
} from "../src/index.js";

// A tiny fake Shield server, same response shape as apps/shield
function fakeShield(verdict: "ALLOW" | "WARN" | "DENY") {
  return (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    expect(url).toMatch(/\/v1\/check$/);
    return new Response(JSON.stringify({
      checkId: "0x01", verdict, riskScore: verdict === "DENY" ? 90 : 0, summary: [], approvals: [], assetChanges: [],
      findings: verdict === "DENY" ? [{ code: "UNLIMITED_APPROVAL_TO_EOA", severity: "deny", message: "drainer" }] : [],
      simulation: { ok: true, available: true },
      receipt: { signer: "0x0000000000000000000000000000000000000001", signature: "0xabcd", expiresAt: 1, message: { agent: body.from, target: body.to, dataHash: "0x" + "00".repeat(32), value: "0", verdict: 0, expiresAt: "1", checkId: "0x" + "11".repeat(32) } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

const ERC20 = parseAbi(["function approve(address,uint256)"]);
const account = privateKeyToAccount(generatePrivateKey());
const wallet = createWalletClient({ account, chain: robinhoodChain, transport: http("http://127.0.0.1:1") });

describe("HeimdallShield client", () => {
  it("posts the transaction and returns the verdict", async () => {
    const shield = new HeimdallShield({ baseUrl: "https://x", fetch: fakeShield("ALLOW") });
    const r = await shield.check({ from: account.address, to: account.address, value: 5n });
    expect(r.verdict).toBe("ALLOW");
  });

  it("reads the Launch Radar, token summaries and the accuracy scorecard", async () => {
    const seen: string[] = [];
    const f = (async (url: string) => { seen.push(new URL(url).pathname); return new Response(JSON.stringify({ tokens: [], summary: "ok", evaluated: 0 }), { status: 200 }); }) as unknown as typeof fetch;
    const shield = new HeimdallShield({ baseUrl: "https://x", fetch: f });
    await shield.radar(); await shield.tokenSummary(account.address); await shield.accuracy();
    expect(seen).toEqual(["/v1/radar", `/v1/token/${account.address}/summary`, "/v1/bench"]);
  });

  it("guardedSend refuses to sign when Shield denies", async () => {
    const shield = new HeimdallShield({ baseUrl: "https://x", fetch: fakeShield("DENY") });
    const data = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [account.address, maxUint256] });
    await expect(guardedSend(wallet, { to: account.address, data }, { shield })).rejects.toBeInstanceOf(HeimdallDenied);
  });

  it("converts receipts into vault.execute arguments", () => {
    const r = receiptArgs({ signer: account.address, signature: "0xab", expiresAt: 10, message: { agent: account.address, target: account.address, dataHash: "0x" + "00".repeat(32) as `0x${string}`, value: "7", verdict: 0, expiresAt: "10", checkId: "0x" + "22".repeat(32) as `0x${string}` } });
    expect(r.receipt.value).toBe(7n);
    expect(r.receipt.expiresAt).toBe(10n);
  });
});

describe("Signals vouchers", () => {
  const signals = "0x00000000000000000000000000000000000000aa" as const;
  it("signs, encodes, decodes and verifies a voucher", async () => {
    const signed = await signVoucher(wallet, { chainId: 4663, signals, signalId: 3n, cumulativeAmount: 150_000n });
    const decoded = decodeVoucherHeader(encodeVoucherHeader(signed));
    expect(decoded.voucher.cumulativeAmount).toBe(150_000n);
    const client = { readContract: async ({ functionName }: { functionName: string }) => (functionName === "available" ? 1_000_000n : 0n) } as unknown as PublicClient;
    const ok = await verifyVoucher(client, { chainId: 4663, signals, signalId: 3n, pricePerCall: 50_000n, acceptedCumulative: 100_000n, signed: decoded });
    expect(ok).toEqual({ ok: true, newCumulative: 150_000n });
    const replay = await verifyVoucher(client, { chainId: 4663, signals, signalId: 3n, pricePerCall: 50_000n, acceptedCumulative: 150_000n, signed: decoded });
    expect(replay.ok).toBe(false);
    const forged = { ...decoded, voucher: { ...decoded.voucher, cumulativeAmount: 9_999_999n } };
    expect((await verifyVoucher(client, { chainId: 4663, signals, signalId: 3n, pricePerCall: 1n, acceptedCumulative: 0n, signed: forged })).ok).toBe(false);
  });
});
