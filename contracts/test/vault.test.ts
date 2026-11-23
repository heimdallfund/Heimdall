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

const ERC20 = parseAbi(["function approve(address,uint256)", "function transfer(address,uint256)"]);
const ROUTER = parseAbi(["function swap(address,address,uint256,address) returns (uint256)"]);
const SWAP = toFunctionSelector("swap(address,address,uint256,address)");
const USDG = (n: number) => BigInt(Math.round(n * 1e6));
const shield = privateKeyToAccount(generatePrivateKey());
let nonce = 0;

async function deploy() {
  const [admin, manager, user, attacker, fees] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const usdg = await viem.deployContract("MockERC20", ["Global Dollar", "USDG", 6]);
  const nvda = await viem.deployContract("MockERC20", ["NVIDIA", "NVDA", 18]);
  const feed = await viem.deployContract("MockFeed", [8, 100n * 10n ** 8n]); // $100
  const router = await viem.deployContract("MockRouter");
  await router.write.setRate([usdg.address, nvda.address, 10n ** 28n]); // 1 USDG -> 0.01 NVDA
  await router.write.setRate([nvda.address, usdg.address, 100n * 10n ** 6n]); // 1 NVDA -> 100 USDG

  const deployer = await viem.deployContract("HeimdallVaultDeployer");
  const factory = await viem.deployContract("HeimdallVaultFactory", [
    usdg.address, deployer.address, admin.account.address, admin.account.address, fees.account.address, shield.address,
  ]);
  await deployer.write.setFactory([factory.address]);
  await factory.write.setDefaults([
    [{ target: router.address, selector: SWAP }],
    [router.address],
    [{ token: nvda.address, feed: feed.address, heartbeat: 3600 }],
  ]);
  await factory.write.createVault(["Mag7 Momentum", "hMAG7", 2500, 300], { account: manager.account });
  const vault = await viem.getContractAt("HeimdallVault", await factory.read.allVaults([0n]));

  await usdg.write.mint([user.account.address, USDG(100_000)]);
  await usdg.write.approve([vault.address, USDG(100_000)], { account: user.account });
  await vault.write.deposit([USDG(10_000), user.account.address], { account: user.account });

  async function receipt(target: Address, data: Hex, opts: { verdict?: number; ttl?: number; signer?: typeof shield; agent?: Address } = {}) {
    const block = await publicClient.getBlock();
    const message = {
      agent: opts.agent ?? vault.address,
      target,
      dataHash: keccak256(data),
      value: 0n,
      verdict: opts.verdict ?? 0,
      expiresAt: block.timestamp + BigInt(opts.ttl ?? 120),
      checkId: keccak256(toHex(`check-${++nonce}`)),
    };
    const signature = await (opts.signer ?? shield).signTypedData({
      domain: { name: "Heimdall Shield", version: "1", chainId },
      types: SHIELD_TYPES, primaryType: "Receipt", message,
    });
    return { message, signature };
  }

  async function exec(target: Address, data: Hex, opts?: Parameters<typeof receipt>[2]) {
    const r = await receipt(target, data, opts);
    return vault.write.execute([target, data, r.message, r.signature], { account: manager.account });
  }

  const approveRouter = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [router.address, USDG(1_000_000)] });
  const swapData = (amount: bigint, to: Address = vault.address, tin: Address = usdg.address, tout: Address = nvda.address) =>
    encodeFunctionData({ abi: ROUTER, functionName: "swap", args: [tin, tout, amount, to] });

  return { admin, manager, user, attacker, fees, usdg, nvda, feed, router, factory, vault, receipt, exec, approveRouter, swapData, publicClient };
}

describe("HeimdallVault", () => {
  it("is created by the factory with the platform as owner and the caller as manager", async () => {
    const { vault, admin, manager } = await networkHelpers.loadFixture(deploy);
    assert.equal((await vault.read.owner()).toLowerCase(), admin.account.address.toLowerCase());
    assert.equal((await vault.read.manager()).toLowerCase(), manager.account.address.toLowerCase());
    assert.equal(await vault.read.totalAssets(), USDG(10_000));
  });

  it("swaps USDG into a stock token within limits", async () => {
    const { vault, nvda, usdg, router, exec, approveRouter, swapData } = await networkHelpers.loadFixture(deploy);
    await exec(usdg.address, approveRouter);
    await exec(router.address, swapData(USDG(1_000)));
    assert.equal(await nvda.read.balanceOf([vault.address]), 10n * 10n ** 18n);
    assert.equal(await vault.read.totalAssets(), USDG(10_000));
  });

  it("rejects calls without a valid Shield receipt", async () => {
    const { vault, manager, usdg, router, receipt, approveRouter } = await networkHelpers.loadFixture(deploy);
    const intruder = privateKeyToAccount(generatePrivateKey());
    const run = (r: Awaited<ReturnType<typeof receipt>>, target: Address = usdg.address, data: Hex = approveRouter) =>
      vault.write.execute([target, data, r.message, r.signature], { account: manager.account });

    await viem.assertions.revertWithCustomError(run(await receipt(usdg.address, approveRouter, { signer: intruder })), vault, "InvalidReceiptSigner");
    await viem.assertions.revertWithCustomError(run(await receipt(usdg.address, approveRouter, { verdict: 1 })), vault, "ReceiptNotAllow");
    await viem.assertions.revertWithCustomError(run(await receipt(usdg.address, approveRouter, { verdict: 2 })), vault, "ReceiptNotAllow");
    await viem.assertions.revertWithCustomError(run(await receipt(router.address, approveRouter)), vault, "ReceiptMismatch");
    await viem.assertions.revertWithCustomError(run(await receipt(usdg.address, approveRouter, { agent: manager.account.address })), vault, "ReceiptMismatch");

    const expired = await receipt(usdg.address, approveRouter, { ttl: 10 });
    await networkHelpers.time.increase(60);
    await viem.assertions.revertWithCustomError(run(expired), vault, "ReceiptExpired");

    const once = await receipt(usdg.address, approveRouter);
    await run(once);
    await viem.assertions.revertWithCustomError(run(once), vault, "ReceiptAlreadyUsed");
  });

  it("only the manager can execute", async () => {
    const { vault, user, usdg, receipt, approveRouter } = await networkHelpers.loadFixture(deploy);
    const r = await receipt(usdg.address, approveRouter);
    await viem.assertions.revertWithCustomError(
      vault.write.execute([usdg.address, approveRouter, r.message, r.signature], { account: user.account }), vault, "NotManager");
  });

  it("allowlist: tokens only take approve to allowed spenders, routers only reviewed selectors", async () => {
    const { vault, usdg, router, attacker, exec } = await networkHelpers.loadFixture(deploy);
    const transfer = encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [attacker.account.address, USDG(1)] });
    await viem.assertions.revertWithCustomError(exec(usdg.address, transfer), vault, "CallNotAllowed");
    const badApprove = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [attacker.account.address, USDG(1)] });
    await viem.assertions.revertWithCustomError(exec(usdg.address, badApprove), vault, "SpenderNotAllowed");
    await viem.assertions.revertWithCustomError(exec(attacker.account.address, "0x12345678"), vault, "CallNotAllowed");
    const poke = encodeFunctionData({ abi: parseAbi(["function setRate(address,address,uint256)"]), functionName: "setRate", args: [usdg.address, usdg.address, 1n] });
    await viem.assertions.revertWithCustomError(exec(router.address, poke), vault, "CallNotAllowed");
    // approving 0 (revoking) is always allowed
    const revoke = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [attacker.account.address, 0n] });
    await exec(usdg.address, revoke);
  });

  it("reverts a trade that sends value away (even with a receipt)", async () => {
    const { vault, usdg, router, attacker, exec, approveRouter, swapData } = await networkHelpers.loadFixture(deploy);
    await exec(usdg.address, approveRouter);
    await viem.assertions.revertWithCustomError(exec(router.address, swapData(USDG(1_000), attacker.account.address)), vault, "LossTooLarge");
  });

  it("enforces the per-trade size limit (25% of NAV)", async () => {
    const { vault, usdg, router, exec, approveRouter, swapData } = await networkHelpers.loadFixture(deploy);
    await exec(usdg.address, approveRouter);
    await viem.assertions.revertWithCustomError(exec(router.address, swapData(USDG(3_000))), vault, "TradeTooLarge");
  });

  it("rejects re-entrancy from a target", async () => {
    const { vault, admin, exec } = await networkHelpers.loadFixture(deploy);
    const evil = await viem.deployContract("ReentrantTarget", [vault.address]);
    await vault.write.setCall([evil.address, toFunctionSelector("poke()"), true], { account: admin.account });
    const poke = encodeFunctionData({ abi: parseAbi(["function poke()"]), functionName: "poke" });
    await viem.assertions.revertWithCustomError(exec(evil.address, poke), vault, "CallFailed");
  });

  it("takes a 15% performance fee above the high-water mark (10% manager, 5% platform)", async () => {
    const { vault, usdg, router, feed, manager, fees, user, exec, approveRouter, swapData } = await networkHelpers.loadFixture(deploy);
    await exec(usdg.address, approveRouter);
    await exec(router.address, swapData(USDG(2_000))); // 20 NVDA @ $100
    await feed.write.set([200n * 10n ** 8n, BigInt(await networkHelpers.time.latest())]); // NVDA doubles → +2,000 profit
    assert.equal(await vault.read.totalAssets(), USDG(12_000));
    await vault.write.harvest();
    const mShares = await vault.read.balanceOf([manager.account.address]);
    const pShares = await vault.read.balanceOf([fees.account.address]);
    const mVal = await vault.read.convertToAssets([mShares]);
    const pVal = await vault.read.convertToAssets([pShares]);
    // 15% of 2,000 = 300 → 200 manager, 100 platform (allow rounding dust)
    assert.ok(mVal > USDG(199.9) && mVal <= USDG(200), `manager fee ${mVal}`);
    assert.ok(pVal > USDG(99.9) && pVal <= USDG(100), `platform fee ${pVal}`);
    const userVal = await vault.read.convertToAssets([await vault.read.balanceOf([user.account.address])]);
    assert.ok(userVal > USDG(11_699.99) && userVal < USDG(11_700.01), `user value ${userVal}`);
    // no double charge
    await vault.write.harvest();
    assert.equal(await vault.read.balanceOf([manager.account.address]), mShares);
  });

  it("limits base-asset withdrawals to idle USDG but always allows in-kind exit, even with a stale feed", async () => {
    const { vault, usdg, nvda, router, feed, user, exec, approveRouter, swapData } = await networkHelpers.loadFixture(deploy);
    await exec(usdg.address, approveRouter);
    await exec(router.address, swapData(USDG(2_500)));
    await exec(router.address, swapData(USDG(2_500)));
    const maxW = await vault.read.maxWithdraw([user.account.address]);
    assert.equal(maxW, USDG(5_000));

    await networkHelpers.time.increase(7200); // feed goes stale (heartbeat 1h)
    await viem.assertions.revertWithCustomError(vault.read.totalAssets(), vault, "StalePrice");
    const shares = await vault.read.balanceOf([user.account.address]);
    const before = await usdg.read.balanceOf([user.account.address]);
    await vault.write.redeemInKind([shares, user.account.address, user.account.address], { account: user.account });
    assert.equal((await usdg.read.balanceOf([user.account.address])) - before, USDG(5_000));
    assert.equal(await nvda.read.balanceOf([user.account.address]), 50n * 10n ** 18n);
    assert.equal(await vault.read.totalSupply(), 0n);
    void feed;
  });

  it("pause stops deposits and trades but not withdrawals", async () => {
    const { vault, admin, user, usdg, exec, approveRouter } = await networkHelpers.loadFixture(deploy);
    await vault.write.pause({ account: admin.account });
    await viem.assertions.revertWithCustomError(vault.write.deposit([USDG(1), user.account.address], { account: user.account }), vault, "EnforcedPause");
    await viem.assertions.revertWithCustomError(exec(usdg.address, approveRouter), vault, "EnforcedPause");
    await vault.write.withdraw([USDG(1_000), user.account.address, user.account.address], { account: user.account });
    assert.equal(await vault.read.totalAssets(), USDG(9_000));
  });

  it("factory enforces risk caps", async () => {
    const { factory, manager } = await networkHelpers.loadFixture(deploy);
    await viem.assertions.revertWithCustomError(
      factory.write.createVault(["Degen", "hDGN", 5000, 300], { account: manager.account }), factory, "LimitAboveCap");
  });
});

describe("HeimdallVault hardening", () => {
  it("caps cumulative trade losses per 24h window (5% of NAV)", async () => {
    const { vault, usdg, nvda, router, feed, exec, approveRouter, swapData } = await networkHelpers.loadFixture(deploy);
    await exec(usdg.address, approveRouter);
    await router.write.setRate([usdg.address, nvda.address, (10n ** 28n * 88n) / 100n]); // pays 88% of fair value
    // each 2,000 USDG trade loses 240 (2.4% < 3%); the third would push the window past 5%
    await exec(router.address, swapData(USDG(2_000)));
    await exec(router.address, swapData(USDG(1_000)));
    await viem.assertions.revertWithCustomError(exec(router.address, swapData(USDG(2_000))), vault, "DailyLossTooLarge");
    await networkHelpers.time.increase(86_401);
    await feed.write.set([100n * 10n ** 8n, BigInt(await networkHelpers.time.latest())]);
    await exec(router.address, swapData(USDG(1_000))); // new window
  });

  it("starts a fresh high-water mark when the vault is empty (donations earn no fee)", async () => {
    const { factory, usdg, user, manager, fees } = await networkHelpers.loadFixture(deploy);
    await factory.write.createVault(["Fresh", "hFR", 2500, 300], { account: manager.account });
    const v = await viem.getContractAt("HeimdallVault", await factory.read.allVaults([1n]));
    await usdg.write.mint([manager.account.address, USDG(1)]);
    await usdg.write.transfer([v.address, USDG(1)], { account: manager.account });
    await usdg.write.approve([v.address, USDG(10_000)], { account: user.account });
    await v.write.deposit([USDG(9_999), user.account.address], { account: user.account });
    await v.write.harvest();
    assert.equal(await v.read.balanceOf([manager.account.address]), 0n);
    assert.equal(await v.read.balanceOf([fees.account.address]), 0n);
  });

  it("$HEIM-holding manager pays half the platform fee (12.5% total)", async () => {
    const { factory, admin, usdg, nvda, router, feed, user, manager, fees, publicClient } = await networkHelpers.loadFixture(deploy);
    const heim = await viem.deployContract("MockERC20", ["Heimdall", "HEIM", 18]);
    await heim.write.mint([manager.account.address, 100_000n * 10n ** 18n]);
    await factory.write.setHolderTerms([heim.address, 100_000n * 10n ** 18n], { account: admin.account });
    await factory.write.createVault(["Holder", "hHLD", 2500, 300], { account: manager.account });
    const v = await viem.getContractAt("HeimdallVault", await factory.read.allVaults([1n]));
    await usdg.write.approve([v.address, USDG(10_000)], { account: user.account });
    await v.write.deposit([USDG(10_000), user.account.address], { account: user.account });
    const chainId = await publicClient.getChainId();
    const run = async (target: Address, data: Hex) => {
      const block = await publicClient.getBlock();
      const message = { agent: v.address, target, dataHash: keccak256(data), value: 0n, verdict: 0, expiresAt: block.timestamp + 120n, checkId: keccak256(toHex(`h-${++nonce}`)) };
      const signature = await shield.signTypedData({ domain: { name: "Heimdall Shield", version: "1", chainId }, types: SHIELD_TYPES, primaryType: "Receipt", message });
      return v.write.execute([target, data, message, signature], { account: manager.account });
    };
    await run(usdg.address, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [router.address, USDG(1_000_000)] }));
    await run(router.address, encodeFunctionData({ abi: ROUTER, functionName: "swap", args: [usdg.address, nvda.address, USDG(2_000), v.address] }));
    await feed.write.set([200n * 10n ** 8n, BigInt(await networkHelpers.time.latest())]);
    await v.write.harvest();
    const pVal = await v.read.convertToAssets([await v.read.balanceOf([fees.account.address])]);
    const mVal = await v.read.convertToAssets([await v.read.balanceOf([manager.account.address])]);
    assert.ok(pVal > USDG(49.9) && pVal <= USDG(50), `platform ${pVal}`);
    assert.ok(mVal > USDG(199.9) && mVal <= USDG(200), `manager ${mVal}`);
  });

  it("owner can replace a dead feed and revoke an allowance; max* views don't revert while stale", async () => {
    const { vault, admin, usdg, nvda, router, user, exec, approveRouter, swapData } = await networkHelpers.loadFixture(deploy);
    await exec(usdg.address, approveRouter);
    await exec(router.address, swapData(USDG(1_000)));
    await networkHelpers.time.increase(7200);
    assert.equal(await vault.read.maxWithdraw([user.account.address]), 0n);
    assert.equal(await vault.read.maxRedeem([user.account.address]), 0n);
    const newFeed = await viem.deployContract("MockFeed", [8, 100n * 10n ** 8n]);
    await vault.write.setFeed([nvda.address, newFeed.address, 3600], { account: admin.account });
    assert.equal(await vault.read.totalAssets(), USDG(10_000));
    await vault.write.revokeApproval([usdg.address, router.address], { account: admin.account });
    assert.equal(await usdg.read.allowance([vault.address, router.address]), 0n);
  });
});

describe("Shield API ↔ Vault compatibility", () => {
  it("accepts a receipt produced by the Shield API signer code", async () => {
    const { vault, admin, usdg, manager, approveRouter, publicClient } = await networkHelpers.loadFixture(deploy);
    const key = generatePrivateKey();
    process.env.SHIELD_SIGNER_KEY = key;
    const { signReceipt } = await import("../../apps/shield/src/receipt.ts");
    const apiSigner = privateKeyToAccount(key);
    await vault.write.setShieldSigner([apiSigner.address, true], { account: admin.account });
    const chainId = await publicClient.getChainId();
    const r = await signReceipt({ chainId, from: vault.address, to: usdg.address, data: approveRouter, value: 0n }, "ALLOW", keccak256(toHex("api-check-1")));
    const message = { ...r.message, value: BigInt(r.message.value), expiresAt: BigInt(r.message.expiresAt) };
    await vault.write.execute([usdg.address, approveRouter, message, r.signature], { account: manager.account });
    assert.equal(await vault.read.usedCheckId([r.message.checkId]), true);
  });
});

describe("Guarded launch", () => {
  it("caps total deposits per vault (10,000 USDG by default) and the admin can raise it", async () => {
    const { vault, user, admin } = await networkHelpers.loadFixture(deploy);
    assert.equal(await vault.read.depositCap(), USDG(10_000));
    assert.equal(await vault.read.maxDeposit([user.account.address]), 0n); // already 10,000 in
    await viem.assertions.revertWithCustomError(vault.write.deposit([USDG(1), user.account.address], { account: user.account }), vault, "ERC4626ExceededMaxDeposit");
    await vault.write.setDepositCap([USDG(25_000)], { account: admin.account });
    assert.equal(await vault.read.maxDeposit([user.account.address]), USDG(15_000));
    await vault.write.deposit([USDG(15_000), user.account.address], { account: user.account });
    assert.equal(await vault.read.totalAssets(), USDG(25_000));
  });

  it("only the deployer's creator can wire the factory, once", async () => {
    const { user } = await networkHelpers.loadFixture(deploy);
    const d = await viem.deployContract("HeimdallVaultDeployer");
    await viem.assertions.revertWithCustomError(d.write.setFactory([user.account.address], { account: user.account }), d, "NotCreator");
  });
});
