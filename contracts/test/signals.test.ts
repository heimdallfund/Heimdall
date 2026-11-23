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
  const [admin, provider, agent, treasury, stranger] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const usdg = await viem.deployContract("MockERC20", ["Global Dollar", "USDG", 6]);
  const signals = await viem.deployContract("HeimdallSignals", [usdg.address, admin.account.address, treasury.account.address]);
  await signals.write.register(['{"name":"Whale moves","category":"onchain"}', USDG(0.05), provider.account.address], { account: provider.account });
  await usdg.write.mint([agent.account.address, USDG(1_000)]);
  await usdg.write.approve([signals.address, USDG(1_000)], { account: agent.account });

  async function voucher(cumulative: bigint, opts: { deadline?: bigint; signer?: typeof agent } = {}) {
    const deadline = opts.deadline ?? BigInt(await networkHelpers.time.latest()) + 3600n;
    const message = { payer: agent.account.address, signalId: 0n, cumulativeAmount: cumulative, deadline };
    const signature = await (opts.signer ?? agent).signTypedData({
      account: (opts.signer ?? agent).account,
      domain: { name: "Heimdall Signals", version: "1", chainId, verifyingContract: signals.address },
      types: VOUCHER_TYPES, primaryType: "Voucher", message,
    });
    return { message, signature };
  }
  return { admin, provider, agent, treasury, stranger, usdg, signals, voucher };
}

describe("HeimdallSignals", () => {
  it("registers a signal with its provider and price", async () => {
    const { signals, provider } = await networkHelpers.loadFixture(deploy);
    const s = await signals.read.getSignal([0n]);
    assert.equal(s.provider.toLowerCase(), provider.account.address.toLowerCase());
    assert.equal(s.pricePerCall, USDG(0.05));
    assert.equal(await signals.read.signalCount(), 1n);
  });

  it("direct pay splits 90% to the provider, 10% to the treasury", async () => {
    const { signals, usdg, agent, provider, treasury } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.emit(signals.write.pay([0n, 20n, keccak256(toHex("req-1")), USDG(0.05)], { account: agent.account }), signals, "Paid");
    assert.equal(await usdg.read.balanceOf([provider.account.address]), USDG(0.9));
    assert.equal(await usdg.read.balanceOf([treasury.account.address]), USDG(0.1));
  });

  it("redeems cumulative vouchers once, only for the unclaimed difference", async () => {
    const { signals, usdg, agent, provider, treasury, voucher } = await networkHelpers.loadFixture(deploy);
    await signals.write.fund([USDG(10)], { account: agent.account });
    const v1 = await voucher(USDG(0.5));
    await signals.write.redeem([v1.message, v1.signature], { account: provider.account });
    await viem.assertions.revertWithCustomError(signals.write.redeem([v1.message, v1.signature]), signals, "NothingToClaim");
    const v2 = await voucher(USDG(2));
    await signals.write.redeem([v2.message, v2.signature]);
    assert.equal(await usdg.read.balanceOf([provider.account.address]), USDG(1.8));
    assert.equal(await usdg.read.balanceOf([treasury.account.address]), USDG(0.2));
    assert.equal(await signals.read.balanceOf([agent.account.address]), USDG(8));
  });

  it("rejects forged, expired and over-budget vouchers", async () => {
    const { signals, agent, stranger, voucher } = await networkHelpers.loadFixture(deploy);
    await signals.write.fund([USDG(1)], { account: agent.account });
    const forged = await voucher(USDG(0.5), { signer: stranger });
    await viem.assertions.revertWithCustomError(signals.write.redeem([forged.message, forged.signature]), signals, "InvalidVoucher");
    const old = await voucher(USDG(0.5), { deadline: 1n });
    await viem.assertions.revertWithCustomError(signals.write.redeem([old.message, old.signature]), signals, "VoucherExpired");
    const big = await voucher(USDG(5));
    await viem.assertions.revertWithCustomError(signals.write.redeem([big.message, big.signature]), signals, "InsufficientBalance");
  });

  it("withdrawals wait for the delay, so accepted vouchers stay redeemable", async () => {
    const { signals, usdg, agent, provider, voucher } = await networkHelpers.loadFixture(deploy);
    await signals.write.fund([USDG(10)], { account: agent.account });
    await signals.write.requestWithdraw([USDG(10)], { account: agent.account });
    await viem.assertions.revertWithCustomError(signals.write.withdraw({ account: agent.account }), signals, "WithdrawLocked");
    const v = await voucher(USDG(3));
    await signals.write.redeem([v.message, v.signature], { account: provider.account });
    await networkHelpers.time.increase(86_401);
    const before = await usdg.read.balanceOf([agent.account.address]);
    await signals.write.withdraw({ account: agent.account });
    assert.equal((await usdg.read.balanceOf([agent.account.address])) - before, USDG(7));
  });

  it("only the provider can update; inactive signals cannot be paid; fee is capped", async () => {
    const { signals, agent, provider, stranger, admin } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.revertWithCustomError(
      signals.write.update([0n, "x", USDG(1), stranger.account.address, true], { account: stranger.account }), signals, "NotProvider");
    await signals.write.update([0n, "x", USDG(1), provider.account.address, false], { account: provider.account });
    await viem.assertions.revertWithCustomError(signals.write.pay([0n, 1n, keccak256(toHex("r")), USDG(1)], { account: agent.account }), signals, "SignalInactive");
    await viem.assertions.revertWithCustomError(signals.write.setFee([2_500], { account: admin.account }), signals, "InvalidConfig");
  });
});
