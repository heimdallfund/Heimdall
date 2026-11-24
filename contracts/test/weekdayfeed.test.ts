import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { zeroAddress } from "viem";

const { viem, networkHelpers } = await network.create();
const WEEK = 7n * 86_400n;
const H = 3_600n;
const USDG = (n: number) => BigInt(Math.round(n * 1e6));

/** Next timestamp after `now` that sits `offset` seconds into the week (week counted from Thursday 00:00 UTC). */
function nextAt(now: bigint, offset: bigint) {
  const start = now - (now % WEEK);
  let t = start + offset;
  while (t <= now) t += WEEK;
  return t;
}

async function setup() {
  const raw = await viem.deployContract("MockFeed", [8, 250_00000000n]); // AMZN $250
  const token = await viem.deployContract("MockStockToken");
  const stock = await viem.deployContract("HeimdallStockFeed", [raw.address, token.address, zeroAddress, 0, "AMZN / USD"]);
  const feed = await viem.deployContract("HeimdallWeekdayFeed", [stock.address, "AMZN / USD (weekdays)"]);
  return { raw, token, stock, feed };
}

async function goTo(ts: bigint, raw?: { write: { set: (a: [bigint, bigint]) => Promise<unknown> } }, freshPrice = true) {
  await networkHelpers.time.setNextBlockTimestamp(ts);
  await networkHelpers.mine();
  if (raw && freshPrice) await raw.write.set([250_00000000n, ts]);
}

describe("HeimdallWeekdayFeed", () => {
  it("passes the wrapped price through on weekdays", async () => {
    const { raw, feed } = await setup();
    const now = BigInt(await networkHelpers.time.latest());
    await goTo(nextAt(now, 5n * 86_400n + 15n * H), raw); // Tuesday 15:00 UTC
    const r = await feed.read.latestRoundData();
    assert.equal(r[1], 250_00000000n);
    assert.ok(r[3] > 0n);
    assert.equal(await feed.read.marketClosed(), false);
    assert.equal(await feed.read.decimals(), 8);
    assert.equal(await feed.read.description(), "AMZN / USD (weekdays)");
  });

  it("is closed from Saturday 00:00 to Monday 01:00 UTC, and open right outside that window", async () => {
    const { raw, feed } = await setup();
    const now = BigInt(await networkHelpers.time.latest());
    const fri = nextAt(now, 1n * 86_400n + 23n * H + 59n * 60n); // Friday 23:59
    const cases: [bigint, boolean, string][] = [
      [fri, false, "Friday 23:59"],
      [fri + 60n, true, "Saturday 00:00"],
      [fri + 60n + 36n * H, true, "Sunday 12:00"],
      [fri + 60n + 48n * H + 59n * 60n, true, "Monday 00:59"],
      [fri + 60n + 49n * H, false, "Monday 01:00"],
    ];
    for (const [ts, closed, label] of cases) {
      await goTo(ts, raw);
      assert.equal(await feed.read.marketClosed(), closed, label);
      const updatedAt = (await feed.read.latestRoundData())[3];
      assert.equal(updatedAt === 0n, closed, `${label}: updatedAt`);
    }
  });

  it("keeps the stock adapter's own stale signals (corporate-action pause) on weekdays", async () => {
    const { raw, token, feed } = await setup();
    const now = BigInt(await networkHelpers.time.latest());
    await goTo(nextAt(now, 6n * 86_400n + 14n * H), raw); // Wednesday 14:00
    await token.write.setPaused([true]);
    assert.equal((await feed.read.latestRoundData())[3], 0n);
  });

  it("a vault holding the stock pauses NAV over the weekend, reopens on fresh Monday prices, and in-kind exits always work", async () => {
    const { raw, stock } = await setup();
    const [admin, manager, user, , fees] = await viem.getWalletClients();
    const usdg = await viem.deployContract("MockERC20", ["Global Dollar", "USDG", 6]);
    const amzn = await viem.deployContract("MockERC20", ["Amazon", "AMZN", 18]);
    const feed = await viem.deployContract("HeimdallWeekdayFeed", [stock.address, "AMZN"]);
    const deployer = await viem.deployContract("HeimdallVaultDeployer");
    const factory = await viem.deployContract("HeimdallVaultFactory", [usdg.address, deployer.address, admin.account.address, admin.account.address, fees.account.address, admin.account.address]);
    await deployer.write.setFactory([factory.address]);
    await factory.write.setDefaults([[], [], [{ token: amzn.address, feed: feed.address, heartbeat: 90_000 }]]);
    await factory.write.createVault(["Weekday", "hWK", 2500, 200], { account: manager.account });
    const vault = await viem.getContractAt("HeimdallVault", await factory.read.allVaults([0n]));

    const now = BigInt(await networkHelpers.time.latest());
    const fri = nextAt(now, 1n * 86_400n + 18n * H); // Friday 18:00
    await goTo(fri, raw);
    await usdg.write.mint([user.account.address, USDG(1_000)]);
    await usdg.write.approve([vault.address, USDG(1_000)], { account: user.account });
    await vault.write.deposit([USDG(500), user.account.address], { account: user.account });
    // the vault holds AMZN too (as if bought earlier): 1 AMZN = 250 USDG
    await amzn.write.mint([vault.address, 10n ** 18n]);
    assert.equal(await vault.read.totalAssets(), USDG(750));

    // Saturday: closed. NAV reverts, deposits are refused, an in-kind exit still pays out both tokens.
    await goTo(fri + 30n * H, raw, false);
    await viem.assertions.revertWithCustomError(vault.read.totalAssets(), vault, "StalePrice");
    await viem.assertions.revertWithCustomError(vault.write.deposit([USDG(100), user.account.address], { account: user.account }), vault, "ERC4626ExceededMaxDeposit");
    const shares = await vault.read.balanceOf([user.account.address]);
    await vault.write.redeemInKind([shares / 2n, user.account.address, user.account.address], { account: user.account });
    assert.ok((await amzn.read.balanceOf([user.account.address])) > 0n);

    // Monday 01:30, no new price since Friday: still stale (vault heartbeat 25 h).
    await goTo(fri + 55n * H + 30n * 60n, raw, false);
    await viem.assertions.revertWithCustomError(vault.read.totalAssets(), vault, "StalePrice");

    // First fresh price after the reopen: open for business again.
    await goTo(fri + 56n * H, raw);
    assert.ok((await vault.read.totalAssets()) > 0n);
    await vault.write.deposit([USDG(100), user.account.address], { account: user.account });
  });

  it("a vault that does not hold the stock is never blocked by the weekend", async () => {
    const { raw, stock } = await setup();
    const [admin, manager, user, , fees] = await viem.getWalletClients();
    const usdg = await viem.deployContract("MockERC20", ["Global Dollar", "USDG", 6]);
    const amzn = await viem.deployContract("MockERC20", ["Amazon", "AMZN", 18]);
    const feed = await viem.deployContract("HeimdallWeekdayFeed", [stock.address, "AMZN"]);
    const deployer = await viem.deployContract("HeimdallVaultDeployer");
    const factory = await viem.deployContract("HeimdallVaultFactory", [usdg.address, deployer.address, admin.account.address, admin.account.address, fees.account.address, admin.account.address]);
    await deployer.write.setFactory([factory.address]);
    await factory.write.setDefaults([[], [], [{ token: amzn.address, feed: feed.address, heartbeat: 90_000 }]]);
    await factory.write.createVault(["Cash", "hCASH", 2500, 200], { account: manager.account });
    const vault = await viem.getContractAt("HeimdallVault", await factory.read.allVaults([0n]));
    const now = BigInt(await networkHelpers.time.latest());
    await goTo(nextAt(now, 3n * 86_400n + 12n * H), raw, false); // Sunday 12:00
    await usdg.write.mint([user.account.address, USDG(100)]);
    await usdg.write.approve([vault.address, USDG(100)], { account: user.account });
    await vault.write.deposit([USDG(100), user.account.address], { account: user.account });
    assert.equal(await vault.read.totalAssets(), USDG(100));
  });

  it("refuses a zero inner feed", async () => {
    await assert.rejects(viem.deployContract("HeimdallWeekdayFeed", [zeroAddress, "x"]), /InvalidConfig/);
  });
});
