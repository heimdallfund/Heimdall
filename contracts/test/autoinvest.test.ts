import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";

const { viem, networkHelpers } = await network.create();
const U = (n: number) => BigInt(Math.round(n * 1e6));
const HOUR = 3600, DAY = 86_400;
const rateFor = (usdPerToken: number) => BigInt(Math.round(1e30 / usdPerToken)); // raw token out per 1e18 raw USDG in

async function setup() {
  const [owner, user, keeper, fees, stranger] = await viem.getWalletClients();
  const usdg = await viem.deployContract("MockERC20", ["Global Dollar", "USDG", 6]);
  const nvda = await viem.deployContract("MockERC20", ["NVIDIA", "NVDA", 18]);
  const feed = await viem.deployContract("MockFeed", [8, 134_00000000n]); // $134 in USDG
  const router = await viem.deployContract("MockSwapRouter02");
  await router.write.setRate([usdg.address, nvda.address, rateFor(134)]);
  const ai = await viem.deployContract("HeimdallAutoInvest", [usdg.address, router.address, owner.account.address, fees.account.address]);
  await ai.write.setAsset([nvda.address, feed.address, 500, 90_000, true], { account: owner.account });
  await usdg.write.mint([user.account.address, U(1_000)]);
  await usdg.write.approve([ai.address, U(400)], { account: user.account }); // budget for 4 buys of 100
  return { owner, user, keeper, fees, stranger, usdg, nvda, feed, router, ai };
}

describe("HeimdallAutoInvest", () => {
  it("buys on schedule from the user's wallet and sends the stock straight to them", async () => {
    const { user, keeper, fees, usdg, nvda, ai } = await setup();
    await ai.write.createPlan([nvda.address, U(100), DAY, 4, 100], { account: user.account });
    await ai.write.execute([0n], { account: keeper.account });
    // 100 USDG − 0.25% fee = 99.75 USDG → 99.75 / 134 NVDA
    const got = await nvda.read.balanceOf([user.account.address]);
    assert.ok(got > 744_000_000_000_000_000n && got < 745_000_000_000_000_000n, `${got}`);
    assert.equal(await usdg.read.balanceOf([user.account.address]), U(900));
    assert.equal(await ai.read.accruedFees(), U(0.25));
    await ai.write.sweepFees({ account: keeper.account });
    assert.equal(await usdg.read.balanceOf([fees.account.address]), U(0.25));
    assert.equal(await ai.read.accruedFees(), 0n);
    assert.equal(await nvda.read.balanceOf([keeper.account.address]), 0n);
    await assert.rejects(ai.write.execute([0n], { account: keeper.account }), /NotDue/);
    await networkHelpers.time.increase(DAY);
    await ai.write.execute([0n], { account: keeper.account });
    assert.equal(await usdg.read.balanceOf([user.account.address]), U(800));
  });

  it("stops after the last buy and when the user cancels", async () => {
    const { user, keeper, nvda, ai } = await setup();
    await ai.write.createPlan([nvda.address, U(100), HOUR, 1, 100], { account: user.account });
    await ai.write.execute([0n], { account: keeper.account });
    await networkHelpers.time.increase(HOUR);
    await assert.rejects(ai.write.execute([0n], { account: keeper.account }), /Inactive/);
    await ai.write.createPlan([nvda.address, U(100), HOUR, 5, 100], { account: user.account });
    await assert.rejects(ai.write.cancelPlan([1n], { account: keeper.account }), /NotOwner/);
    await ai.write.cancelPlan([1n], { account: user.account });
    await assert.rejects(ai.write.execute([1n], { account: keeper.account }), /Inactive/);
  });

  it("refuses to buy at a price worse than the user's bound versus the oracle", async () => {
    const { user, keeper, nvda, router, usdg, ai } = await setup();
    await ai.write.createPlan([nvda.address, U(100), DAY, 3, 100], { account: user.account }); // 1% max
    await router.write.setRate([usdg.address, nvda.address, rateFor(136)]); // pool 1.5% above oracle
    await assert.rejects(ai.write.execute([0n], { account: keeper.account }));
    assert.equal(await usdg.read.balanceOf([user.account.address]), U(1_000)); // nothing taken
    await router.write.setRate([usdg.address, nvda.address, rateFor(135)]);  // 0.75% above: inside the bound
    await ai.write.execute([0n], { account: keeper.account });
  });

  it("does nothing while the oracle is stale", async () => {
    const { user, keeper, nvda, feed, ai } = await setup();
    await ai.write.createPlan([nvda.address, U(100), DAY, 3, 100], { account: user.account });
    const now = BigInt(await networkHelpers.time.latest());
    await feed.write.set([134_00000000n, now - 100_000n]);
    await assert.rejects(ai.write.execute([0n], { account: keeper.account }), /OracleUnavailable/);
    assert.equal(await ai.read.oraclePrice([nvda.address]), 0n);
  });

  it("stops when the user's allowance runs out, and validates plans and admin calls", async () => {
    const { owner, user, keeper, stranger, fees, nvda, usdg, ai } = await setup();
    await usdg.write.approve([ai.address, U(50)], { account: user.account });
    await ai.write.createPlan([nvda.address, U(100), DAY, 3, 100], { account: user.account });
    await assert.rejects(ai.write.execute([0n], { account: keeper.account }));
    await assert.rejects(ai.write.createPlan([nvda.address, U(100), 60, 3, 100], { account: user.account }));   // interval
    await assert.rejects(ai.write.createPlan([nvda.address, U(100), DAY, 3, 600], { account: user.account }));  // slippage
    await assert.rejects(ai.write.createPlan([usdg.address, U(100), DAY, 3, 100], { account: user.account }));  // not an asset
    await assert.rejects(ai.write.setFee([101, fees.account.address], { account: owner.account }));
    await assert.rejects(ai.write.setAsset([nvda.address, nvda.address, 500, 1, true], { account: stranger.account }));
  });

  it("keeps the fee a plan started with, and a frozen fee recipient never blocks a buy", async () => {
    const { owner, user, keeper, stranger, usdg, nvda, ai } = await setup();
    await ai.write.createPlan([nvda.address, U(100), DAY, 4, 100], { account: user.account });   // at 0.25%
    await ai.write.setFee([100, stranger.account.address], { account: owner.account });           // raised to 1% later
    await ai.write.execute([0n], { account: keeper.account });
    assert.equal(await ai.read.accruedFees(), U(0.25));
    assert.equal((await ai.read.getPlan([0n])).feeBps, 25);
    await ai.write.createPlan([nvda.address, U(100), DAY, 1, 100], { account: user.account });   // new plan: 1%
    await ai.write.execute([1n], { account: keeper.account });
    assert.equal(await ai.read.accruedFees(), U(1.25));
    // fees wait in the contract; buys never transfer to the recipient themselves
    assert.equal(await usdg.read.balanceOf([stranger.account.address]), 0n);
    await ai.write.sweepFees({ account: user.account });
    assert.equal(await usdg.read.balanceOf([stranger.account.address]), U(1.25));
  });
});
