import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { zeroAddress } from "viem";

const { viem } = await network.create();
const E = (n: bigint) => n * 10n ** 18n;

describe("HeimdallHolderBalance", () => {
  it("counts held plus staked $HEIM, so a staker keeps holder benefits in Signals", async () => {
    const [owner, payer, staker] = await viem.getWalletClients();
    const heim = await viem.deployContract("MockERC20", ["Heimdall", "HEIM", 18]);
    const usdg = await viem.deployContract("MockERC20", ["Global Dollar", "USDG", 6]);
    const staking = await viem.deployContract("HeimdallStaking", [heim.address, usdg.address, owner.account.address]);
    const hb = await viem.deployContract("HeimdallHolderBalance", [heim.address, staking.address]);
    await heim.write.mint([staker.account.address, E(150_000n)]);
    await heim.write.approve([staking.address, E(120_000n)], { account: staker.account });
    await staking.write.stake([E(120_000n)], { account: staker.account });
    assert.equal(await heim.read.balanceOf([staker.account.address]), E(30_000n));
    assert.equal(await hb.read.balanceOf([staker.account.address]), E(150_000n));

    const signals = await viem.deployContract("HeimdallSignals", [usdg.address, owner.account.address, owner.account.address]);
    await signals.write.setHolderTerms([hb.address, E(100_000n), 500]);
    assert.equal(await signals.read.feeFor([staker.account.address]), 500n);      // staked 120k + held 30k → holder
    assert.equal(await signals.read.feeFor([payer.account.address]), 1_000n);     // non-holder pays the standard 10%
  });

  it("rejects a zero address", async () => {
    const heim = await viem.deployContract("MockERC20", ["Heimdall", "HEIM", 18]);
    await assert.rejects(viem.deployContract("HeimdallHolderBalance", [heim.address, zeroAddress]));
  });
});
