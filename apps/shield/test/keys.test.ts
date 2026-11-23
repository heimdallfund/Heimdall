import { describe, expect, it } from "vitest";
import { verifyMessage, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildApp } from "../src/server.js";
import { MemoryStore } from "../src/store.js";
import { limitsFromEnv } from "../src/limits.js";

const owner = privateKeyToAccount(generatePrivateKey());
const client = {
  verifyMessage: (args: Parameters<typeof verifyMessage>[0]) => verifyMessage(args),
  getCode: async () => "0x6080",
  getBalance: async () => 10n ** 18n,
  readContract: async ({ functionName }: { functionName: string }) => (functionName === "symbol" ? "X" : functionName === "decimals" ? 6 : 10n ** 30n),
  request: async () => [{ calls: [{ status: "0x1", gasUsed: "0x1", logs: [] }] }],
} as unknown as PublicClient;

const json = (b: unknown, h: Record<string, string> = {}) => ({ method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json", ...h } });

describe("Self-service API keys", () => {
  it("sign in with a wallet, create, use, list and revoke a key", async () => {
    const env = { SHIELD_FREE_RPM: "1000" } as NodeJS.ProcessEnv;
    const app = buildApp({ env, getClient: () => client, store: new MemoryStore(), limits: limitsFromEnv(env), log: () => {} });

    const { message } = await (await app.request("/v1/auth/challenge", json({ address: owner.address }))).json() as { message: string };
    expect(message).toContain(owner.address);
    const bad = await app.request("/v1/auth/verify", json({ address: owner.address, signature: await privateKeyToAccount(generatePrivateKey()).signMessage({ message }) }));
    expect(bad.status).toBe(401);
    // challenge is still valid after a failed attempt
    const { session } = await (await app.request("/v1/auth/verify", json({ address: owner.address, signature: await owner.signMessage({ message }) }))).json() as { session: string };
    expect(session).toBeTruthy();
    const auth = { authorization: `Session ${session}` };

    expect((await app.request("/v1/keys", { headers: {} })).status).toBe(401);
    const created = await (await app.request("/v1/keys", json({ name: "trader-01" }, auth))).json() as { id: string; key: string };
    expect(created.key).toMatch(/^hd_live_/);

    const check = await app.request("/v1/check", json({ from: owner.address, to: owner.address, data: "0x" }, { authorization: `Bearer ${created.key}` }));
    expect(check.status).toBe(200);
    expect(check.headers.get("x-ratelimit-limit")).toBe("600");

    const keys = await (await app.request("/v1/keys", { headers: auth })).json() as { id: string; checksToday: number; last4: string }[];
    expect(keys).toHaveLength(1);
    expect(keys[0]!.checksToday).toBe(1);
    expect(created.key.endsWith(keys[0]!.last4)).toBe(true);

    expect((await app.request(`/v1/keys/${created.id}`, { method: "DELETE", headers: auth })).status).toBe(200);
    expect((await app.request("/v1/check", json({ from: owner.address, to: owner.address, data: "0x" }, { authorization: `Bearer ${created.key}` }))).status).toBe(401);
  });
});
