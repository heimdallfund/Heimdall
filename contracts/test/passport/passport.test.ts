import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { network } from "hardhat";
import { getAddress, keccak256, toHex } from "viem";
import { buildApp } from "../../../apps/shield/src/server.ts";
import { MemoryStore } from "../../../apps/shield/src/store.ts";
import { publishPassports } from "../../../apps/monitor/src/jobs.ts";

const { viem } = await network.create({ override: { chainId: 4663 } });
const ADMIN_KEY = "test-admin-key";

describe("Agent Passport: ERC-8004 link, Heimdall Score, published onchain", () => {
  it("links only with onchain proof, scores from Pay and Shield, and publishes the score to the Reputation Registry", async () => {
    const [deployer, agent, stranger, publisher, client] = await viem.getWalletClients();
    const pc = await viem.getPublicClient();
    const identity = await viem.deployContract("MockIdentityRegistry");
    const reputation = await viem.deployContract("MockReputationRegistry", [identity.address]);
    const reg = { name: "Momentum agent", description: "Buys NVDA dips", services: [{ name: "MCP", endpoint: "https://momentum.example/mcp" }], x402Support: true, active: true };
    await identity.write.register([`data:application/json;base64,${Buffer.from(JSON.stringify(reg)).toString("base64")}`], { account: agent.account });

    // a real Pay record: the agent completed 25 jobs
    const usdg = await viem.deployContract("MockERC20", ["Global Dollar", "USDG", 6]);
    const pay = await viem.deployContract("HeimdallPay", [usdg.address, deployer.account.address, deployer.account.address]);
    await usdg.write.mint([client.account.address, 10_000_000_000n]);
    await usdg.write.approve([pay.address, 10_000_000_000n], { account: client.account });
    const now = BigInt((await pc.getBlock()).timestamp);
    for (let i = 0n; i < 25n; i++) {
      await pay.write.createJob([agent.account.address, stranger.account.address, 10_000_000n, now + 86_400n, 3600, 0, keccak256(toHex(`job${i}`))], { account: client.account });
      await pay.write.release([i], { account: client.account });
    }

    const store = new MemoryStore();
    // the agent's Shield history: 60 checks, none denied, first seen 40 days ago
    for (const [k, v] of [["checks", 60], ["allowed", 58], ["warned", 2], ["denied", 0]] as const) await store.incr(`agent:${agent.account.address.toLowerCase()}:${k}`, 86_400, v);
    await store.put(`agent:${agent.account.address.toLowerCase()}:first`, String(Date.now() - 40 * 86_400_000));
    const app = buildApp({
      store, getClient: () => pc as never, log: () => {},
      env: { NODE_ENV: "test", ERC8004_IDENTITY: identity.address, ERC8004_REPUTATION: reputation.address, HEIMDALL_PAY_ADDRESS: pay.address, PASSPORT_PUBLISHER_ADDRESS: publisher.account.address, SHIELD_ADMIN_KEY_SHA256: createHash("sha256").update(ADMIN_KEY).digest("hex"), SHIELD_PUBLIC_URL: "https://api.heimdall.fund" },
    });
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) => app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

    // a stranger cannot link someone else's agent to their wallet
    const bad = await post("/v1/passport/link", { address: stranger.account.address, agentId: "0" });
    assert.equal(bad.status, 403);
    const ok = await post("/v1/passport/link", { address: agent.account.address, agentId: 0 });
    assert.equal(ok.status, 200, await ok.clone().text());

    const p = await (await app.request(`/v1/passport/${agent.account.address}`)).json() as { agentId: string; score: number; tier: string; identity: { registration: { name: string } }; pay: { completed: number }; components: { name: string }[] };
    assert.equal(p.agentId, "0");
    assert.equal(p.identity.registration.name, "Momentum agent");
    assert.equal(p.pay.completed, 25);
    assert.ok(p.score >= 85, `score ${p.score}`);
    assert.equal(p.tier, "A");
    // also reachable by agentId
    const byId = await (await app.request("/v1/passport/0")).json() as { address: string };
    assert.equal(getAddress(byId.address), getAddress(agent.account.address));

    // the monitor publishes the score as Heimdall's ERC-8004 feedback
    const fetchApp = ((url: string, init?: RequestInit) => app.request(new URL(url).pathname, init)) as typeof fetch;
    const r = await publishPassports(publisher as never, pc as never, "http://shield", ADMIN_KEY, reputation.address, fetchApp);
    assert.equal(r.published.length, 1);
    const [count, value] = await reputation.read.getSummary([0n, [publisher.account.address], "heimdall", ""]);
    assert.equal(count, 1n);
    assert.equal(Number(value), p.score);
    // the feedback file is served at the URI written onchain
    const logs = await reputation.getEvents.NewFeedback();
    const uri = logs[0].args.feedbackURI!;
    const file = await (await app.request(new URL(uri).pathname)).json() as { agentId: number; value: number; tag1: string };
    assert.deepEqual([file.agentId, file.value, file.tag1], [0, p.score, "heimdall"]);
    assert.equal(keccak256(toHex(JSON.stringify(file))), logs[0].args.feedbackHash);

    // unchanged score: nothing new is published the next day
    const again = await publishPassports(publisher as never, pc as never, "http://shield", ADMIN_KEY, reputation.address, fetchApp);
    assert.equal(again.published.length, 0);
    // and the passport now shows the onchain reputation
    await store.remove(`memo:passport:${agent.account.address.toLowerCase()}:`);
    const p2 = await (await app.request(`/v1/passport/${agent.account.address}`)).json() as { reputation: { count: number; average: number } };
    assert.deepEqual([p2.reputation.count, p2.reputation.average], [1, p.score]);
  });
});
