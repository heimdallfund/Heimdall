import { describe, it, expect } from "vitest";
import { handleA2A, agentCard } from "../src/a2a.js";

const call = (status: number, body: unknown, headers: Record<string, string> = {}) => {
  const seen: { path: string; body?: string }[] = [];
  const fn = async (path: string, init?: RequestInit) => { seen.push({ path, body: init?.body as string | undefined }); return new Response(JSON.stringify(body), { status, headers }); };
  return { fn, seen };
};
const send = (parts: unknown[], method = "SendMessage") => ({ jsonrpc: "2.0", id: 7, method, params: { message: { messageId: "m1", role: "ROLE_USER", parts } } });

describe("A2A", () => {
  it("publishes an agent card with a JSON-RPC interface and three skills", () => {
    const c = agentCard("https://api.heimdall.fund");
    expect(c.supportedInterfaces[0]).toEqual({ url: "https://api.heimdall.fund/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" });
    expect(c.skills.map((s) => s.id)).toEqual(["check-transaction", "check-signature", "check-address"]);
  });

  it("routes a transaction data part to /v1/check and returns a completed task with the verdict", async () => {
    const { fn, seen } = call(200, { verdict: "DENY", findings: [{ severity: "deny", message: "Known drainer." }] });
    const r = await handleA2A(send([{ data: { from: "0x1111111111111111111111111111111111111111", to: "0x2222222222222222222222222222222222222222" }, mediaType: "application/json" }]), fn) as any;
    expect(seen[0]!.path).toBe("/v1/check");
    expect(r.id).toBe(7);
    expect(r.result.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(r.result.task.artifacts[0].parts[0].text).toBe("Verdict: DENY. Known drainer. Do not sign.");
    expect(r.result.task.artifacts[0].parts[1].data.verdict).toBe("DENY");
  });

  it("routes signatures and plain-text addresses, and speaks the legacy v0.3 method", async () => {
    const sig = call(200, { verdict: "ALLOW", findings: [] });
    await handleA2A(send([{ data: { signer: "0x1111111111111111111111111111111111111111", message: "hi" } }]), sig.fn);
    expect(sig.seen[0]!.path).toBe("/v1/check-signature");
    const addr = call(200, { address: "0x281FF81dF0Eca1F3F7Ba2A48499c7A83D216a2A8", levelName: "CRITICAL", flagNames: ["DRAINER"] });
    const r = await handleA2A(send([{ kind: "text", text: "Is 0x281FF81dF0Eca1F3F7Ba2A48499c7A83D216a2A8 safe?" }], "message/send"), addr.fn) as any;
    expect(addr.seen[0]!.path).toBe("/v1/risk/0x281FF81dF0Eca1F3F7Ba2A48499c7A83D216a2A8");
    expect(r.result.kind).toBe("task");
    expect(r.result.status.state).toBe("completed");
    expect(r.result.artifacts[0].parts[0]).toEqual({ kind: "text", text: "0x281FF81dF0Eca1F3F7Ba2A48499c7A83D216a2A8: CRITICAL (DRAINER)." });
  });

  it("asks for payment over the free tier, rejects what it cannot read, and refuses other methods", async () => {
    const pay = call(402, { error: "payment_required" }, { "payment-required": "eyJ4In0=" });
    const p = await handleA2A(send([{ data: { from: "0x1111111111111111111111111111111111111111" } }]), pay.fn) as any;
    expect(p.result.task.status.state).toBe("TASK_STATE_AUTH_REQUIRED");
    expect(p.result.task.metadata.paymentRequired).toBe("eyJ4In0=");
    const none = await handleA2A(send([{ text: "hello" }]), call(200, {}).fn) as any;
    expect(none.result.task.status.state).toBe("TASK_STATE_REJECTED");
    expect((await handleA2A({ jsonrpc: "2.0", id: 1, method: "SendStreamingMessage" } as never, call(200, {}).fn) as any).error.code).toBe(-32004);
    expect((await handleA2A({ id: 1 } as never, call(200, {}).fn) as any).error.code).toBe(-32600);
  });
});
