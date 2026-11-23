// Regression tests for the HeimdallVault findings in SECURITY_REVIEW.md. Each scenario is the original
// PoC attack; the assertions now require the attack to FAIL (fixed behaviour).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodeFunctionData, keccak256, parseAbi, toFunctionSelector, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const { viem, networkHelpers } = await network.create();

const SHIELD_TYPES = {
  Receipt: [
    { name: "agent", type: "address" },
    { name: "target", type: "address" },
    { name: "dataHash", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "verdict", type: "uint8" },
    { name: "expiresAt", type: "uint64" },
    { name: "checkId", type: "bytes32" },
  ],
} as const;

const ERC20 = parseAbi([
  "function approve(address,uint256)",
  "function increaseApproval(address,uint256)",
]);
const ROUTER = parseAbi(["function swap(address,address,uint256,address) returns (uint256)"]);
const USDG = (n: number) => BigInt(Math.round(n * 1e6));
const E18 = 10n ** 18n;
const shield = privateKeyToAccount(generatePrivateKey());
let nonce = 0;

async function base(paxosLike: boolean) {
  const [admin, manager, user, attacker, fees, user2] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const usdg = paxosLike
    ? await viem.deployContract("PaxosLikeToken", ["Global Dollar", "USDG", 6])
    : await viem.deployContract("MockERC20", ["Global Dollar", "USDG", 6]);
  const nvda = await viem.deployContract("MockERC20", ["NVIDIA", "NVDA", 18]);
  const feed = await viem.deployContract("MockFeed", [8, 100n * 10n ** 8n]); // $100
  const router = await viem.deployContract("MockRouter");
  await router.write.setRate([usdg.address, nvda.address, 10n ** 28n]);
  await router.write.setRate([nvda.address, usdg.address, 100n * 10n ** 6n]);

  const deployer = await viem.deployContract("HeimdallVaultDeployer");
  const factory = await viem.deployContract("HeimdallVaultFactory", [
    usdg.address, deployer.address, admin.account.address, admin.account.address, fees.account.address, shield.address,
  ]);
  await deployer.write.setFactory([factory.address]);
  await factory.write.setDefaults([
    [{ target: router.address, selector: toFunctionSelector("swap(address,address,uint256,address)") }],
    [router.address],
    [{ token: nvda.address, feed: feed.address, heartbeat: 3600 }],
  ]);
  await factory.write.createVault(["Mag7 Momentum", "hMAG7", 2500, 300], { account: manager.account });
  const vault = await viem.getContractAt("HeimdallVault", await factory.read.allVaults([0n]));

  for (const u of [user, user2]) {
    await usdg.write.mint([u.account.address, USDG(100_000)]);
    await usdg.write.approve([vault.address, USDG(100_000)], { account: u.account });
  }
  await usdg.write.mint([manager.account.address, USDG(100)]);

  async function exec(target: Address, data: Hex) {
    const block = await publicClient.getBlock();
    const message = {
      agent: vault.address, target, dataHash: keccak256(data), value: 0n, verdict: 0,
      expiresAt: block.timestamp + 120n, checkId: keccak256(toHex(`poc-${++nonce}`)),
    };
    const signature = await shield.signTypedData({
      domain: { name: "Heimdall Shield", version: "1", chainId }, types: SHIELD_TYPES, primaryType: "Receipt", message,
    });
    return vault.write.execute([target, data, message, signature], { account: manager.account });
  }
  const approve = (spender: Address, amt: bigint) => encodeFunctionData({ abi: ERC20, functionName: "approve", args: [spender, amt] });
  const swap = (tin: Address, tout: Address, amount: bigint) =>
    encodeFunctionData({ abi: ROUTER, functionName: "swap", args: [tin, tout, amount, vault.address] });
  return { admin, manager, user, user2, attacker, fees, usdg, nvda, feed, router, factory, vault, exec, approve, swap, publicClient };
}
const fixtureMock = () => base(false);
const fixturePaxos = () => base(true);

describe("C-01 fixed: no allowance outside approve-to-allowed-spender", () => {
  it("increaseApproval to an attacker contract is rejected", async () => {
    const { vault, usdg, user, exec } = await networkHelpers.loadFixture(fixturePaxos);
    await vault.write.deposit([USDG(10_000), user.account.address], { account: user.account });
    const puller = await viem.deployContract("Puller");
    const grant = encodeFunctionData({ abi: ERC20, functionName: "increaseApproval", args: [puller.address, USDG(10_000)] });
    await viem.assertions.revertWithCustomError(exec(usdg.address, grant), vault, "CallNotAllowed");
    assert.equal(await usdg.read.allowance([vault.address, puller.address]), 0n);
  });
});

describe("H-01 fixed: cumulative loss is capped per 24h", () => {
  it("bad-price trades stop once the window has lost 5% of NAV", async () => {
    const { vault, usdg, nvda, router, user, exec, approve, swap } = await networkHelpers.loadFixture(fixtureMock);
    await vault.write.deposit([USDG(10_000), user.account.address], { account: user.account });
    await exec(usdg.address, approve(router.address, 2n ** 255n));
    await router.write.setRate([usdg.address, nvda.address, (10n ** 28n * 86n) / 100n]);
    await router.write.setRate([nvda.address, usdg.address, (100n * 10n ** 6n * 86n) / 100n]);
    const nav0 = await vault.read.totalAssets();
    let reverted = false;
    for (let i = 0; i < 25 && !reverted; i++) {
      const nav = await vault.read.totalAssets();
      const size = (nav * 20n) / 100n;
      const idle = await usdg.read.balanceOf([vault.address]);
      if (idle < size) break;
      try { await exec(router.address, swap(usdg.address, nvda.address, size)); } catch { reverted = true; }
    }
    const nav1 = await vault.read.totalAssets();
    assert.ok(reverted, "a trade should have been stopped");
    assert.ok(nav1 * 10_000n >= nav0 * 9_500n, `NAV fell from ${nav0} to ${nav1}`);
  });
});

describe("H-02 fixed: no performance fee on principal", () => {
  it("a donation into an empty vault earns the manager nothing", async () => {
    const { vault, usdg, user, manager, fees } = await networkHelpers.loadFixture(fixtureMock);
    await usdg.write.transfer([vault.address, USDG(1)], { account: manager.account });
    await vault.write.deposit([USDG(9_999), user.account.address], { account: user.account });
    await vault.write.harvest({ account: manager.account });
    assert.equal(await vault.read.balanceOf([manager.account.address]), 0n);
    assert.equal(await vault.read.balanceOf([fees.account.address]), 0n);
  });

  it("dust left after a full exit earns no fee on the next deposit", async () => {
    const { vault, usdg, user, user2, manager, fees } = await networkHelpers.loadFixture(fixtureMock);
    await vault.write.deposit([USDG(10_000), user.account.address], { account: user.account });
    const shares = await vault.read.balanceOf([user.account.address]);
    await vault.write.redeemInKind([shares, user.account.address, user.account.address], { account: user.account });
    await usdg.write.transfer([vault.address, 1n], { account: manager.account });
    await vault.write.deposit([USDG(5_000), user2.account.address], { account: user2.account });
    await vault.write.harvest();
    assert.equal(await vault.read.balanceOf([manager.account.address]), 0n);
    assert.equal(await vault.read.balanceOf([fees.account.address]), 0n);
  });
});

describe("M-01 fixed: in-kind exit always works", () => {
  it("a halted token can be skipped with redeemInKindExcept", async () => {
    const { vault, usdg, admin, user } = await networkHelpers.loadFixture(fixtureMock);
    const halt = await viem.deployContract("PausableToken");
    const hFeed = await viem.deployContract("MockFeed", [8, 10n ** 8n]);
    await vault.write.addAsset([halt.address, hFeed.address, 3600], { account: admin.account });
    await vault.write.deposit([USDG(10_000), user.account.address], { account: user.account });
    await halt.write.mint([vault.address, E18]);
    await halt.write.setHalted([true]);
    const shares = await vault.read.balanceOf([user.account.address]);
    const before = await usdg.read.balanceOf([user.account.address]);
    await vault.write.redeemInKindExcept([shares, user.account.address, user.account.address, [halt.address]], { account: user.account });
    assert.ok((await usdg.read.balanceOf([user.account.address])) - before > USDG(9_999)); // minus a tiny fee on the 1 USDG airdrop
  });

  it("a feed returning empty data no longer blocks redeemInKind or harvest", async () => {
    const { vault, admin, user } = await networkHelpers.loadFixture(fixtureMock);
    const tok = await viem.deployContract("MockERC20", ["AAPL", "AAPL", 18]);
    const goodFeed = await viem.deployContract("MockFeed", [8, 10n ** 8n]);
    await vault.write.addAsset([tok.address, goodFeed.address, 3600], { account: admin.account });
    const badFeed = await viem.deployContract("EmptyReturnFeed");
    await assert.rejects(vault.write.setFeed([tok.address, badFeed.address, 3600], { account: admin.account })); // no decimals()
    await vault.write.deposit([USDG(10_000), user.account.address], { account: user.account });
    await tok.write.mint([vault.address, 1n]);
    await networkHelpers.time.increase(7200); // feed stale
    await vault.write.harvest();
    const shares = await vault.read.balanceOf([user.account.address]);
    await vault.write.redeemInKind([shares, user.account.address, user.account.address], { account: user.account });
    assert.equal(await vault.read.totalSupply(), 0n);
  });
});

describe("M-02 fixed: a dead feed can be replaced", () => {
  it("owner swaps the feed and the vault works again", async () => {
    const { vault, usdg, admin, user, nvda, router, exec, approve, swap } = await networkHelpers.loadFixture(fixtureMock);
    await vault.write.deposit([USDG(10_000), user.account.address], { account: user.account });
    await exec(usdg.address, approve(router.address, USDG(1_000_000)));
    await exec(router.address, swap(usdg.address, nvda.address, USDG(1_000)));
    await networkHelpers.time.increase(7200);
    await viem.assertions.revertWithCustomError(exec(router.address, swap(usdg.address, nvda.address, USDG(10))), vault, "StalePrice");
    const newFeed = await viem.deployContract("MockFeed", [8, 100n * 10n ** 8n]);
    await vault.write.setFeed([nvda.address, newFeed.address, 3600], { account: admin.account });
    await exec(router.address, swap(usdg.address, nvda.address, USDG(10)));
    await vault.write.withdraw([USDG(1), user.account.address, user.account.address], { account: user.account });
  });
});

describe("M-03 fixed: allowances can always be revoked", () => {
  it("manager can approve(x, 0) and the owner can revokeApproval", async () => {
    const { vault, usdg, admin, user, router, exec, approve } = await networkHelpers.loadFixture(fixtureMock);
    await vault.write.deposit([USDG(10_000), user.account.address], { account: user.account });
    await exec(usdg.address, approve(router.address, 2n ** 255n));
    await vault.write.setSpender([router.address, false], { account: admin.account });
    await exec(usdg.address, approve(router.address, 0n));
    assert.equal(await usdg.read.allowance([vault.address, router.address]), 0n);
    await exec(usdg.address, approve(admin.account.address, 0n));
    await vault.write.revokeApproval([usdg.address, router.address], { account: admin.account });
  });
});
