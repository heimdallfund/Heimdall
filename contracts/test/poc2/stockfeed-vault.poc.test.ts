import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodeFunctionData, keccak256, parseAbi, toFunctionSelector, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Regression tests for review 2 (HeimdallStockFeed <-> HeimdallVault). L-05 is accepted by design; I-04 and I-05 are fixed.
const { viem, networkHelpers } = await network.create();
const SHIELD_TYPES = {
  Receipt: [
    { name: "agent", type: "address" }, { name: "target", type: "address" }, { name: "dataHash", type: "bytes32" },
    { name: "value", type: "uint256" }, { name: "verdict", type: "uint8" }, { name: "expiresAt", type: "uint64" },
    { name: "checkId", type: "bytes32" },
  ],
} as const;
const ERC20 = parseAbi(["function approve(address,uint256)"]);
const ROUTER = parseAbi(["function swap(address,address,uint256,address) returns (uint256)"]);
const SWAP = toFunctionSelector("swap(address,address,uint256,address)");
const U = (n: number) => BigInt(Math.round(n * 1e6));
const shield = privateKeyToAccount(generatePrivateKey());
let nonce = 0;

async function deploy() {
  const [admin, manager, user, fees] = await viem.getWalletClients();
  const pc = await viem.getPublicClient();
  const chainId = await pc.getChainId();
  const usdg = await viem.deployContract("MockERC20", ["Global Dollar", "USDG", 6]);
  const nvda = await viem.deployContract("MockERC20", ["NVIDIA", "NVDA", 18]);
  const rawFeed = await viem.deployContract("MockFeed", [8, 100n * 10n ** 8n]);   // NVDA/USD $100
  const quote = await viem.deployContract("MockFeed", [8, 1n * 10n ** 8n]);       // USDG/USD $1
  const stockToken = await viem.deployContract("MockStockToken");                 // carries oraclePaused()
  const adapter = await viem.deployContract("HeimdallStockFeed", [rawFeed.address, stockToken.address, quote.address, 86_400, "NVDA / USDG"]);
  const router = await viem.deployContract("MockRouter");
  await router.write.setRate([usdg.address, nvda.address, 10n ** 28n]);
  await router.write.setRate([nvda.address, usdg.address, 100n * 10n ** 6n]);
  const deployer = await viem.deployContract("HeimdallVaultDeployer");
  const factory = await viem.deployContract("HeimdallVaultFactory", [usdg.address, deployer.address, admin.account.address, admin.account.address, fees.account.address, shield.address]);
  await deployer.write.setFactory([factory.address]);
  await factory.write.setDefaults([[{ target: router.address, selector: SWAP }], [router.address], [{ token: nvda.address, feed: adapter.address, heartbeat: 3600 }]]);
  await factory.write.createVault(["Mag7", "hMAG7", 2500, 300], { account: manager.account });
  const vault = await viem.getContractAt("HeimdallVault", await factory.read.allVaults([0n]));
  await usdg.write.mint([user.account.address, U(100_000)]);
  await usdg.write.approve([vault.address, U(100_000)], { account: user.account });
  await vault.write.deposit([U(5_000), user.account.address], { account: user.account });

  async function exec(target: Address, data: Hex) {
    const block = await pc.getBlock();
    const message = { agent: vault.address, target, dataHash: keccak256(data), value: 0n, verdict: 0, expiresAt: block.timestamp + 120n, checkId: keccak256(toHex(`c-${++nonce}`)) };
    const signature = await shield.signTypedData({ domain: { name: "Heimdall Shield", version: "1", chainId }, types: SHIELD_TYPES, primaryType: "Receipt", message });
    return vault.write.execute([target, data, message, signature], { account: manager.account });
  }
  // put 20% of NAV into NVDA through a real trade
  await exec(usdg.address, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [router.address, U(1_000_000)] }));
  await exec(router.address, encodeFunctionData({ abi: ROUTER, functionName: "swap", args: [usdg.address, nvda.address, U(1_000), vault.address] }));
  return { admin, manager, user, usdg, nvda, rawFeed, quote, stockToken, adapter, router, vault, exec };
}

describe("PoC2: HeimdallStockFeed + HeimdallVault", () => {
  it("baseline: adapter + vault value NVDA correctly when live", async () => {
    const { vault, nvda } = await networkHelpers.loadFixture(deploy);
    assert.equal(await nvda.read.balanceOf([vault.address]), 10n * 10n ** 18n);
    assert.equal(await vault.read.totalAssets(), U(5_000));
  });

  it("L-05: one paused stock freezes USDG deposits, USDG withdrawals and ALL manager trades vault-wide (only redeemInKind works)", async () => {
    const { vault, user, usdg, stockToken, router, exec } = await networkHelpers.loadFixture(deploy);
    await stockToken.write.setPaused([true]); // corporate action on NVDA
    await viem.assertions.revertWithCustomError(vault.read.totalAssets(), vault, "StalePrice");
    await viem.assertions.revertWithCustomError(vault.write.deposit([U(100), user.account.address], { account: user.account }), vault, "ERC4626ExceededMaxDeposit");
    await viem.assertions.revertWithCustomError(vault.write.withdraw([U(100), user.account.address, user.account.address], { account: user.account }), vault, "ERC4626ExceededMaxWithdraw");
    assert.equal(await vault.read.maxWithdraw([user.account.address]), 0n);
    // the manager cannot even move the idle USDG into anything else / de-risk while NVDA is paused
    await viem.assertions.revertWithCustomError(exec(router.address, encodeFunctionData({ abi: ROUTER, functionName: "swap", args: [usdg.address, usdg.address, U(1), router.address] })), vault, "StalePrice");
    // in-kind exit still works
    const shares = await vault.read.balanceOf([user.account.address]);
    await vault.write.redeemInKind([shares / 2n, user.account.address, user.account.address], { account: user.account });
    assert.ok((await usdg.read.balanceOf([user.account.address])) > U(95_000));
  });

  it("I-04 fixed: the vault rejects heartbeats above 7 days, so the adapter's stale signal always counts", async () => {
    const { admin, vault, nvda, adapter, stockToken } = await networkHelpers.loadFixture(deploy);
    await assert.rejects(vault.write.setFeed([nvda.address, adapter.address, 4_000_000_000], { account: admin.account }));
    await assert.rejects(vault.write.setFeed([nvda.address, adapter.address, 7 * 86_400 + 1], { account: admin.account }));
    await vault.write.setFeed([nvda.address, adapter.address, 7 * 86_400], { account: admin.account });
    await stockToken.write.setPaused([true]);
    await viem.assertions.revertWithCustomError(vault.read.totalAssets(), vault, "StalePrice");
  });

  it("I-05 fixed: the adapter only accepts a stock token with the pause flag, and an unreadable flag counts as paused", async () => {
    const { rawFeed, quote, nvda, usdg } = await networkHelpers.loadFixture(deploy);
    await assert.rejects(viem.deployContract("HeimdallStockFeed", [rawFeed.address, nvda.address, quote.address, 86_400, "x"]));
    await assert.rejects(viem.deployContract("HeimdallStockFeed", [rawFeed.address, usdg.address, quote.address, 86_400, "x"]));
  });

  it("sanity (no finding): broken / overflowing quote or feed fail closed in the vault", async () => {
    const { vault, quote, rawFeed } = await networkHelpers.loadFixture(deploy);
    const now = BigInt(await networkHelpers.time.latest());
    await quote.write.set([2n ** 255n - 1n, now]); // overflow inside the band check -> adapter reverts -> vault sees stale
    await viem.assertions.revertWithCustomError(vault.read.totalAssets(), vault, "StalePrice");
    await quote.write.set([1n * 10n ** 8n, now]);
    await rawFeed.write.set([0n, now]);
    await viem.assertions.revertWithCustomError(vault.read.totalAssets(), vault, "StalePrice");
    await rawFeed.write.set([100n * 10n ** 8n, now + 10n]); // updatedAt in the future
    await viem.assertions.revertWithCustomError(vault.read.totalAssets(), vault, "StalePrice");
  });
});
