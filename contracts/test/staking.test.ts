import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";

const { viem, networkHelpers } = await network.create();
const DAY = 86_400n, WEEK = 7n * DAY;
const H = (n: number) => BigInt(n) * 10n ** 18n;   // HEIM
const U = (n: number) => BigInt(Math.round(n * 1e6)); // USDG

async function setup() {
  const [admin, alice, bob, treasury, payer] = await viem.getWalletClients();
  const heim = await viem.deployContract("MockERC20", ["Heimdall", "HEIM", 18]);
  const usdg = await viem.deployContract("MockERC20", ["Global Dollar", "USDG", 6]);
  // payer acts as the distributor for the direct staking tests; the splitter gets its own staking instance
  const staking = await viem.deployContract("HeimdallStaking", [heim.address, usdg.address, payer.account.address]);
  const splitter = await viem.deployContract("HeimdallFeeSplitter", [usdg.address, admin.account.address, "0x0000000000000000000000000000000000000000", treasury.account.address, 0]);
  const stakingS = await viem.deployContract("HeimdallStaking", [heim.address, usdg.address, splitter.address]);
  await splitter.write.setConfig([stakingS.address, treasury.account.address, 5000], { account: admin.account });
  for (const w of [alice, bob]) {
    await heim.write.mint([w.account.address, H(1_000_000)]);
    await heim.write.approve([staking.address, H(1_000_000)], { account: w.account });
  }
  await usdg.write.mint([payer.account.address, U(1_000_000)]);
  await usdg.write.approve([staking.address, U(1_000_000)], { account: payer.account });
  for (const w of [alice, bob]) await heim.write.approve([stakingS.address, H(1_000_000)], { account: w.account });
  return { admin, alice, bob, treasury, payer, heim, usdg, staking, stakingS, splitter };
}
const near = (a: bigint, b: bigint, tol = 2n) => assert.ok(a >= b - tol && a <= b + tol, `${a} ≉ ${b}`);

describe("HeimdallStaking", () => {
  it("streams USDG over 7 days, pro rata to stake", async () => {
    const { alice, bob, payer, usdg, staking } = await setup();
    await staking.write.stake([H(300)], { account: alice.account });
    await staking.write.stake([H(100)], { account: bob.account });
    await staking.write.notifyReward([U(700)], { account: payer.account });
    await networkHelpers.time.increase(WEEK + 10n);
    near(await staking.read.earned([alice.account.address]), U(525), 5n);
    near(await staking.read.earned([bob.account.address]), U(175), 5n);
    await staking.write.exit({ account: alice.account });
    near(await usdg.read.balanceOf([alice.account.address]), U(525), 5n);
  });

  it("a stake made right before a payout and pulled right after earns almost nothing", async () => {
    const { alice, bob, payer, staking } = await setup();
    await staking.write.stake([H(100)], { account: alice.account });
    await staking.write.stake([H(10_000)], { account: bob.account }); // whale jumps in
    await staking.write.notifyReward([U(7_000)], { account: payer.account });
    await networkHelpers.time.increase(60n);
    await staking.write.exit({ account: bob.account });               // and out a minute later
    const got = await staking.read.rewards([bob.account.address]);
    assert.ok(got <= U(1), `whale kept ${got}`); // ≈ 7000 × 60 s / 7 days ≈ 0.69 USDG
    await networkHelpers.time.increase(WEEK);
    near(await staking.read.earned([alice.account.address]), U(7_000) - U(0.7), U(0.05));
  });

  it("keeps rewards that arrive while nobody stakes for the next stakers", async () => {
    const { alice, payer, staking } = await setup();
    await staking.write.notifyReward([U(700)], { account: payer.account }); // no stakers yet
    await networkHelpers.time.increase(DAY);
    await staking.write.stake([H(10)], { account: alice.account });
    await networkHelpers.time.increase(WEEK);
    const direct = await staking.read.earned([alice.account.address]);
    near(direct, U(600), U(0.01)); // the 6 days she was staked
    await staking.write.notifyReward([0n], { account: payer.account });    // folds the missed day back in
    await networkHelpers.time.increase(WEEK + 1n);
    near(await staking.read.earned([alice.account.address]), U(700), U(0.01));
  });

  it("only the distributor can add rewards", async () => {
    const { alice, staking } = await setup();
    await assert.rejects(staking.write.notifyReward([1n], { account: alice.account }), /NotDistributor/);
  });

  it("rejects zero amounts and over-withdrawals", async () => {
    const { alice, staking } = await setup();
    await assert.rejects(staking.write.stake([0n], { account: alice.account }));
    await staking.write.stake([H(1)], { account: alice.account });
    await assert.rejects(staking.write.withdraw([H(2)], { account: alice.account }));
  });
});

describe("HeimdallFeeSplitter", () => {
  it("sends the staker share of USDG to staking and the rest to the treasury", async () => {
    const { alice, treasury, usdg, heim, stakingS, splitter } = await setup();
    await stakingS.write.stake([H(1)], { account: alice.account });
    await usdg.write.mint([splitter.address, U(1_000)]);
    await splitter.write.distribute([usdg.address]);
    assert.equal(await usdg.read.balanceOf([treasury.account.address]), U(500));
    assert.equal(await usdg.read.balanceOf([stakingS.address]), U(500));
    // other tokens (e.g. vault fee shares) go to the treasury
    await heim.write.mint([splitter.address, H(5)]);
    await splitter.write.distribute([heim.address]);
    assert.equal(await heim.read.balanceOf([treasury.account.address]), H(5));
  });

  it("keeps the stakers' share for future stakers while nobody stakes, and caps the share", async () => {
    const { admin, treasury, usdg, staking, stakingS, splitter } = await setup();
    await usdg.write.mint([splitter.address, U(100)]);
    await splitter.write.distribute([usdg.address]);
    assert.equal(await usdg.read.balanceOf([treasury.account.address]), U(50));
    assert.equal(await usdg.read.balanceOf([stakingS.address]), U(50));
    await assert.rejects(splitter.write.setConfig([staking.address, treasury.account.address, 9000], { account: admin.account }));
    const [, , , , stranger] = await viem.getWalletClients();
    await assert.rejects(splitter.write.setConfig([staking.address, treasury.account.address, 1000], { account: stranger.account }));
  });
});
