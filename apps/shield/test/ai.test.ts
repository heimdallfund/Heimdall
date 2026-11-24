import { describe, expect, it } from "vitest";
import { summarizeTokenCheck } from "../src/ai.js";
import type { TokenCheck } from "../src/tokencheck.js";

const check = {
  token: "0x0000000000000000000000000000000000000001", symbol: "MEME", name: "Meme", decimals: 18, totalSupply: "1", owner: null,
  verdict: "DENY", riskScore: 95, findings: [{ code: "HONEYPOT", severity: "deny", message: "Selling reverts at 0x1111111111111111111111111111111111111111." }],
  pool: null, buy: { ok: true, taxPct: 0 }, sell: { ok: false, taxPct: null }, transfer: null, pullableBy: [], checkedAt: 0,
  launch: { launchpad: "Pons", model: "curve", dev: "0x0000000000000000000000000000000000000002", graduated: false, progressPct: 12 }, holders: null,
} as unknown as TokenCheck;

describe("AI summary", () => {
  it("returns null without a gateway credential", async () => {
    const saved = { k: process.env.AI_GATEWAY_API_KEY, o: process.env.VERCEL_OIDC_TOKEN };
    delete process.env.AI_GATEWAY_API_KEY; delete process.env.VERCEL_OIDC_TOKEN;
    expect(await summarizeTokenCheck(check, { fetcher: () => { throw new Error("must not call"); } })).toBeNull();
    Object.assign(process.env, saved.k ? { AI_GATEWAY_API_KEY: saved.k } : {}, saved.o ? { VERCEL_OIDC_TOKEN: saved.o } : {});
  });

  it("sends only the check's facts, with addresses removed, and returns the text", async () => {
    let sent: { model: string; messages: { role: string; content: string }[] } | null = null;
    const fetcher = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "Selling fails.\nBottom line: do not buy." } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const text = await summarizeTokenCheck(check, { oidc: "t", fetcher });
    expect(text).toBe("Selling fails.\nBottom line: do not buy.");
    const user = JSON.parse(sent!.messages[1]!.content);
    expect(user.verdict).toBe("DENY");
    expect(user.launchpad).toMatchObject({ name: "Pons", onBondingCurve: true });
    expect(JSON.stringify(user)).not.toMatch(/0x1111/);
  });

  it("returns null when the gateway refuses", async () => {
    const fetcher = (async () => new Response("no credits", { status: 402 })) as unknown as typeof fetch;
    expect(await summarizeTokenCheck(check, { oidc: "t", fetcher })).toBeNull();
  });
});
