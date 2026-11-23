// Regression tests for the HeimdallSignals findings in SECURITY_REVIEW.md (attacks must now fail).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { keccak256, toHex } from "viem";

const { viem, networkHelpers } = await network.create();
const USDG = (n: number) => BigInt(Math.round(n * 1e6));
const VOUCHER_TYPES = {
  Voucher: [
    { name: "payer", type: "address" },
    { name: "signalId", type: "uint256" },
    { name: "cumulativeAmount", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

async function deploy() {
  const [admin, provider, agent, treasury] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const usdg = await viem.deployContract("MockERC20", ["Global Dollar", "USDG", 6]);
  const signals = await viem.deployContract("HeimdallSignals", [usdg.address, admin.account.address, treasury.account.address]);
  await signals.write.register(["sig", USDG(0.05), provider.account.address], { account: provider.account });
  await usdg.write.mint([agent.account.address, USDG(1_000)]);
  await usdg.write.approve([signals.address, 2n ** 256n - 1n], { account: agent.account }); // common "infinite" approval
  async function voucher(cumulative: bigint) {
    const deadline = BigInt(await networkHelpers.time.latest()) + 3600n;
    const message = { payer: agent.account.address, signalId: 0n, cumulativeAmount: cumulative, deadline };
    const signature = await agent.signTypedData({
      account: agent.account,
      domain: { name: "Heimdall Signals", version: "1", chainId, verifyingContract: signals.address },
      types: VOUCHER_TYPES, primaryType: "Voucher", message,
    });
    return { message, signature };
  }
  return { admin, provider, agent, treasury, usdg, signals, voucher };
}

describe("M-04 fixed: a pending withdrawal is visible and expires", () => {
  it("pending amount is excluded from available(), and an old request cannot be used", async () => {
    const { signals, agent } = await networkHelpers.loadFixture(deploy);
    await signals.write.fund([USDG(100)], { account: agent.account });
    await signals.write.requestWithdraw([USDG(100)], { account: agent.account });
    assert.equal(await signals.read.available([agent.account.address]), 0n); // providers see nothing to rely on
    await networkHelpers.time.increase(86_400 * 5); // past delay + 3-day window
    await viem.assertions.revertWithCustomError(signals.write.withdraw({ account: agent.account }), signals, "WithdrawExpired");
  });
});

describe("M-05 fixed: pay() has a price bound", () => {
  it("a front-run price change makes pay() revert instead of overcharging", async () => {
    const { signals, usdg, agent, provider } = await networkHelpers.loadFixture(deploy);
    await signals.write.update([0n, "sig", USDG(50), provider.account.address, true], { account: provider.account });
    await viem.assertions.revertWithCustomError(
      signals.write.pay([0n, 20n, keccak256(toHex("req")), USDG(0.05)], { account: agent.account }), signals, "PriceAboveMax");
    assert.equal(await usdg.read.balanceOf([agent.account.address]), USDG(1_000));
  });
});

describe("$HEIM holder fee", () => {
  it("payout wallets holding $HEIM pay 5% instead of 10%", async () => {
    const { signals, usdg, agent, provider, treasury, admin } = await networkHelpers.loadFixture(deploy);
    const heim = await viem.deployContract("MockERC20", ["Heimdall", "HEIM", 18]);
    await heim.write.mint([provider.account.address, 100_000n * 10n ** 18n]);
    await signals.write.setHolderTerms([heim.address, 100_000n * 10n ** 18n, 500], { account: admin.account });
    await signals.write.pay([0n, 20n, keccak256(toHex("h")), USDG(0.05)], { account: agent.account });
    assert.equal(await usdg.read.balanceOf([provider.account.address]), USDG(0.95));
    assert.equal(await usdg.read.balanceOf([treasury.account.address]), USDG(0.05));
  });
});
