import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { createWalletClient, custom, getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildApp } from "../../../apps/shield/src/server.ts";
import { MemoryStore } from "../../../apps/shield/src/store.ts";
import { decodeHeader } from "../../../apps/shield/src/x402.ts";
import { payX402 } from "../../../packages/sdk/src/x402.ts";

// a local chain with Robinhood Chain's id, so Shield's facilitator signs for 4663
const { viem } = await network.create({ override: { chainId: 4663 } });
const HARDHAT_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("Shield paywall over x402 (real app, local chain 4663)", () => {
  it("answers 402 when the free limit is used up, settles the agent's USDG payment and serves the call", async () => {
    const pc = await viem.getPublicClient();
    const [, treasury] = await viem.getWalletClients();
    const usdg = await viem.deployContract("MockEIP3009");
    // an agent that holds USDG and no ETH at all: x402 is gasless for the payer
    const agentAccount = privateKeyToAccount(generatePrivateKey());
    await usdg.write.mint([agentAccount.address, 1_000_000n]);
    const agent = createWalletClient({ account: agentAccount, transport: custom({ request: (a) => pc.request(a as never) }) });

    const store = new MemoryStore();
    const app = buildApp({
      store,
      getClient: () => pc as never,
      env: { NODE_ENV: "test", X402_PAY_TO: treasury.account.address, X402_FACILITATOR_KEY: HARDHAT_0, X402_ASSET: usdg.address, SHIELD_PUBLIC_URL: "https://api.heimdall.fund" },
      limits: { keys: new Map(), requireKey: false, freePerMinute: 0, proPerMinute: 600, freeChecksPerWalletPerDay: 1000 },
      log: () => {},
    });
    let lastPayment = "";
    const fetchApp = ((url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      if (h.get("payment-signature")) lastPayment = h.get("payment-signature")!;
      return app.request(url, init);
    }) as typeof fetch;
    const body = JSON.stringify({ chainId: 4663, signer: agentAccount.address, message: "Sign in to example.com\nNonce: 42" });
    const init = { method: "POST", headers: { "content-type": "application/json" }, body };

    // free limit used up → 402 with the x402 v2 header
    const first = await fetchApp("http://shield/v1/check-signature", init);
    assert.equal(first.status, 402);
    const pr = decodeHeader<{ x402Version: number; accepts: { amount: string; payTo: string; asset: string; network: string }[] }>(first.headers.get("payment-required")!)!;
    assert.equal(pr.x402Version, 2);
    assert.equal(pr.accepts[0].amount, "1000");
    assert.equal(pr.accepts[0].network, "eip155:4663");
    assert.equal(getAddress(pr.accepts[0].payTo), getAddress(treasury.account.address));

    // the SDK pays and retries; Shield settles onchain and answers
    let settlement: unknown;
    const pay = payX402(fetchApp, agent as never, { maxAmount: 10_000n, networks: { "eip155:4663": { chainId: 4663, network: "eip155:4663", asset: usdg.address, name: "Global Dollar", version: "1" } }, onPay: (p) => { settlement = p.settlement; } });
    const res = await pay("http://shield/v1/check-signature", init);
    assert.equal(res.status, 200, await res.clone().text());
    const verdict = await res.json() as { verdict: string };
    assert.ok(["ALLOW", "WARN", "DENY"].includes(verdict.verdict));
    assert.equal(await usdg.read.balanceOf([treasury.account.address]), 1000n);
    assert.equal(await usdg.read.balanceOf([agentAccount.address]), 999_000n);
    assert.equal((settlement as { success: boolean }).success, true);

    // the same payment header cannot buy a second call for free
    assert.ok(lastPayment);
    const reused = await app.request("http://shield/v1/check-signature", { ...init, headers: { "content-type": "application/json", "payment-signature": lastPayment } });
    assert.equal(reused.status, 402);
    assert.equal(((await reused.json()) as { error: string }).error, "payment_already_used");
    assert.equal(await usdg.read.balanceOf([treasury.account.address]), 1000n);

    // two requests racing with one fresh payment: exactly one is served
    const racer = payX402(((url: string, i?: RequestInit) => {
      const h = new Headers(i?.headers);
      if (!h.get("payment-signature")) return app.request(url, i);
      return Promise.all([app.request(url, i), app.request(url, i)]).then(([a, b]) => { racing = [a.status, b.status].sort(); return a; });
    }) as typeof fetch, agent as never, { maxAmount: 10_000n, networks: { "eip155:4663": { chainId: 4663, network: "eip155:4663", asset: usdg.address, name: "Global Dollar", version: "1" } } });
    let racing: number[] = [];
    await racer("http://shield/v1/check-signature", init);
    assert.deepEqual(racing, [200, 402]);
    assert.equal(await usdg.read.balanceOf([treasury.account.address]), 2000n);

    // discovery lists Shield's own paid endpoints; stats count the paid call
    const disc = await (await app.request("http://shield/discovery/resources")).json() as { items: { resource: string }[] };
    assert.ok(disc.items.some((i) => i.resource === "https://api.heimdall.fund/v1/check"));
    const stats = await (await app.request("http://shield/x402/stats")).json() as { paidShieldCalls: number; enabled: boolean };
    assert.equal(stats.enabled, true);
    assert.equal(stats.paidShieldCalls, 2);
    const supported = await (await app.request("http://shield/x402/supported")).json() as { kinds: { network: string }[] };
    assert.ok(supported.kinds.some((k) => k.network === "eip155:4663"));
  });
});
