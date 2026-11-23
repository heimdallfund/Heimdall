import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { keccak256, toHex, zeroAddress } from "viem";

const { viem, networkHelpers } = await network.create();
const U = (n: number) => BigInt(Math.round(n * 1e6));
const HOUR = 3600, DAY = 86_400;
const spec = keccak256(toHex("Summarise NVDA 10-Q, max 300 words"));
const result = keccak256(toHex("ipfs://bafy…result"));

async function setup() {
  const [owner, client, provider, arbiter, fees, stranger] = await viem.getWalletClients();
  const usdg = await viem.deployContract("MockERC20", ["Global Dollar", "USDG", 6]);
  const pay = await viem.deployContract("HeimdallPay", [usdg.address, owner.account.address, fees.account.address]);
  await usdg.write.mint([client.account.address, U(10_000)]);
  await usdg.write.approve([pay.address, U(10_000)], { account: client.account });
  const now = BigInt(await networkHelpers.time.latest());
  const create = (o: { amount?: number; arbiter?: `0x${string}`; arbFee?: number; deadline?: bigint; review?: number } = {}) =>
    pay.write.createJob([provider.account.address, o.arbiter ?? arbiter.account.address, U(o.amount ?? 100), o.deadline ?? now + BigInt(DAY), o.review ?? 2 * HOUR, o.arbFee ?? 500, spec], { account: client.account });
  const bal = (a: { account: { address: `0x${string}` } }) => usdg.read.balanceOf([a.account.address]);
  return { owner, client, provider, arbiter, fees, stranger, usdg, pay, create, bal, now };
}

describe("HeimdallPay", () => {
  it("escrows, then pays the provider minus 1% when the client releases", async () => {
    const { client, provider, fees, pay, create, bal } = await setup();
    await create();
    assert.equal((await pay.read.getJob([0n])).status, 1);
    await pay.write.submit([0n, result], { account: provider.account });
    await pay.write.release([0n], { account: client.account });
    assert.equal(await bal(provider), U(99));
    assert.equal(await bal(fees), U(1));
    assert.equal(await pay.read.completedOf([provider.account.address]), 1n);
    assert.equal(await pay.read.earnedOf([provider.account.address]), U(99));
    assert.equal((await pay.read.getJob([0n])).resultHash, result);
    assert.deepEqual(await pay.read.jobsOfProvider([provider.account.address]), [0n]);
  });

  it("anyone can release after the review window if the client stays silent", async () => {
    const { provider, stranger, pay, create, bal } = await setup();
    await create();
    await pay.write.submit([0n, result], { account: provider.account });
    await assert.rejects(pay.write.claim([0n], { account: stranger.account }));
    await networkHelpers.time.increase(2 * HOUR);
    await pay.write.claim([0n], { account: stranger.account });
    assert.equal(await bal(provider), U(99));
  });

  it("refunds the client when the deadline passes with no submission", async () => {
    const { client, provider, stranger, pay, create, bal } = await setup();
    await create();
    await assert.rejects(pay.write.refund([0n], { account: stranger.account }));
    await networkHelpers.time.increase(DAY + 1);
    await assert.rejects(pay.write.submit([0n, result], { account: provider.account }));
    await pay.write.refund([0n], { account: stranger.account });
    assert.equal(await bal(client), U(10_000));
  });

  it("a dispute goes to the arbiter, who splits it and earns its fee", async () => {
    const { client, provider, arbiter, fees, pay, create, bal } = await setup();
    await create({ amount: 1000, arbFee: 500 });
    await pay.write.submit([0n, result], { account: provider.account });
    await pay.write.dispute([0n, "Missed half the brief"], { account: client.account });
    await assert.rejects(pay.write.claim([0n]));                  // no auto-release while disputed
    await assert.rejects(pay.write.resolve([0n, 6000], { account: client.account }));
    await pay.write.resolve([0n, 6000], { account: arbiter.account });
    // 1000 → arbiter 50; 950 left → provider gross 570 (fee 5.70), client 380
    assert.equal(await bal(arbiter), U(50));
    assert.equal(await bal(fees), U(5.7));
    assert.equal(await bal(provider), U(564.3));
    assert.equal(await bal(client), U(9_000 + 380));
    assert.equal(await pay.read.disputedOf([provider.account.address]), 1n);
  });

  it("disputes need an arbiter and must come inside the review window", async () => {
    const { client, provider, pay, create } = await setup();
    await create({ arbiter: zeroAddress, arbFee: 0 });
    await pay.write.submit([0n, result], { account: provider.account });
    await assert.rejects(pay.write.dispute([0n, "x"], { account: client.account }));
    await create();
    await pay.write.submit([1n, result], { account: provider.account });
    await networkHelpers.time.increase(2 * HOUR);
    await assert.rejects(pay.write.dispute([1n, "late"], { account: client.account }));
  });

  it("the provider can cancel and refund in full; strangers cannot touch a job", async () => {
    const { client, provider, stranger, pay, create, bal } = await setup();
    await create();
    await assert.rejects(pay.write.release([0n], { account: stranger.account }));
    await assert.rejects(pay.write.submit([0n, result], { account: stranger.account }));
    await pay.write.cancel([0n], { account: provider.account });
    assert.equal(await bal(client), U(10_000));
    await assert.rejects(pay.write.release([0n], { account: client.account })); // already refunded
  });

  it("locks the fee at creation and caps admin changes", async () => {
    const { owner, client, provider, fees, stranger, pay, create, bal } = await setup();
    await create();
    await pay.write.setFee([300, fees.account.address], { account: owner.account });
    await pay.write.release([0n], { account: client.account });
    assert.equal(await bal(provider), U(99)); // still 1%: the rate when the job was created
    await assert.rejects(pay.write.setFee([301, fees.account.address], { account: owner.account }));
    await assert.rejects(pay.write.setFee([100, fees.account.address], { account: stranger.account }));
  });

  it("rejects bad jobs", async () => {
    const { client, provider, pay, now } = await setup();
    const bad = (p: `0x${string}`, arb: `0x${string}`, amt: bigint, dl: bigint, rw: number, af: number) =>
      assert.rejects(pay.write.createJob([p, arb, amt, dl, rw, af, spec], { account: client.account }));
    await bad(client.account.address, zeroAddress, U(1), now + 1000n, HOUR, 0);   // self
    await bad(provider.account.address, zeroAddress, 0n, now + 1000n, HOUR, 0);    // zero amount
    await bad(provider.account.address, zeroAddress, U(1), now - 1n, HOUR, 0);     // past deadline
    await bad(provider.account.address, zeroAddress, U(1), now + 1000n, 60, 0);    // review too short
    await bad(provider.account.address, zeroAddress, U(1), now + 1000n, HOUR, 50); // arbiter fee without arbiter
  });
});
