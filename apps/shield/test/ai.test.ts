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
    const saved = { k: process.env.AI_GATEWAY_API_KEY, o: process.env.VERCEL_OIDC_TOKEN, r: process.env.OPENROUTER_API_KEY };
    delete process.env.AI_GATEWAY_API_KEY; delete process.env.VERCEL_OIDC_TOKEN; delete process.env.OPENROUTER_API_KEY;
    expect(await summarizeTokenCheck(check, { fetcher: () => { throw new Error("must not call"); } })).toBeNull();
    Object.assign(process.env, saved.k ? { AI_GATEWAY_API_KEY: saved.k } : {}, saved.o ? { VERCEL_OIDC_TOKEN: saved.o } : {}, saved.r ? { OPENROUTER_API_KEY: saved.r } : {});
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
    expect(user.kind).toBe("launchpad memecoin");
    expect(user.launchpad).toMatchObject({ name: "Pons", onBondingCurve: true });
    expect(JSON.stringify(user)).not.toMatch(/0x1111/);
  });

  it("uses OpenRouter first when its key is set, then falls back to the gateway", async () => {
    process.env.OPENROUTER_API_KEY = "or-test";
    const urls: string[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      urls.push(url);
      if (url.includes("openrouter")) {
        expect((init.headers as Record<string, string>).authorization).toBe("Bearer or-test");
        return new Response("no credits", { status: 402 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await summarizeTokenCheck(check, { oidc: "t", fetcher })).toBe("ok");
    expect(urls[0]).toContain("openrouter.ai");
    expect(urls.at(-1)).toContain("ai-gateway.vercel.sh");
    delete process.env.OPENROUTER_API_KEY;
  });

  it("tells the model a known stock token is a stock, not a memecoin", async () => {
    let user: { kind?: string } = {};
    const fetcher = (async (_u: string, init: RequestInit) => {
      user = JSON.parse(JSON.parse(String(init.body)).messages[1].content);
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const amzn = { ...check, token: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", symbol: "AMZN", verdict: "ALLOW", launch: null } as unknown as TokenCheck;
    await summarizeTokenCheck(amzn, { oidc: "t", fetcher });
    expect(user.kind).toBe("stock token");
  });

  it("returns null when the gateway refuses", async () => {
    const fetcher = (async () => new Response("no credits", { status: 402 })) as unknown as typeof fetch;
    expect(await summarizeTokenCheck(check, { oidc: "t", fetcher })).toBeNull();
  });
});
