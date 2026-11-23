import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { zeroAddress } from "viem";

const { viem, networkHelpers } = await network.create();

async function setup(withQuote = true) {
  const stock = await viem.deployContract("MockFeed", [8, 134_00000000n]); // $134
  const usdg = await viem.deployContract("MockFeed", [8, 1_00000000n]); // $1.00
  const token = await viem.deployContract("MockStockToken");
  const adapter = await viem.deployContract("HeimdallStockFeed", [stock.address, token.address, withQuote ? usdg.address : zeroAddress, 90_000, "NVDA / USDG"]);
  return { stock, usdg, token, adapter };
}

describe("HeimdallStockFeed", () => {
  it("passes the stock price through when USDG is at par", async () => {
    const { adapter } = await setup();
    const r = await adapter.read.latestRoundData();
    assert.equal(r[1], 134_00000000n);
    assert.ok(r[3] > 0n);
    assert.equal(await adapter.read.decimals(), 8);
    assert.equal(await adapter.read.description(), "NVDA / USDG");
  });

  it("prices in USDG: a USDG at $0.98 makes the stock worth more USDG", async () => {
    const { adapter, usdg } = await setup();
    const now = BigInt(await networkHelpers.time.latest());
    await usdg.write.set([98_000000n, now]);
    const r = await adapter.read.latestRoundData();
    assert.equal(r[1], 13673469387n); // 134 / 0.98 = 136.73469387
  });

  it("reports stale while the token's oracle is paused for a corporate action", async () => {
    const { adapter, token } = await setup();
    await token.write.setPaused([true]);
    assert.equal((await adapter.read.latestRoundData())[3], 0n);
    assert.equal(await adapter.read.paused(), true);
    await token.write.setPaused([false]);
    assert.ok((await adapter.read.latestRoundData())[3] > 0n);
  });

  it("reports stale when the USDG quote is stale, depegged or broken", async () => {
    const { adapter, usdg } = await setup();
    const now = BigInt(await networkHelpers.time.latest());
    await usdg.write.set([1_00000000n, now - 100_000n]);
    assert.equal((await adapter.read.latestRoundData())[3], 0n, "stale quote");
    await usdg.write.set([85_000000n, now]);
    assert.equal((await adapter.read.latestRoundData())[3], 0n, "below band");
    await usdg.write.set([1_20000000n, now]);
    assert.equal((await adapter.read.latestRoundData())[3], 0n, "above band");
    await usdg.write.set([0n, now]);
    assert.equal((await adapter.read.latestRoundData())[3], 0n, "zero");
  });

  it("works without a quote feed, and refuses a token without the pause flag", async () => {
    const { stock, token } = await setup(false);
    const adapter = await viem.deployContract("HeimdallStockFeed", [stock.address, token.address, zeroAddress, 0, "x"]);
    const r = await adapter.read.latestRoundData();
    assert.equal(r[1], 134_00000000n);
    assert.ok(r[3] > 0n);
    const plain = await viem.deployContract("MockFeed", [8, 1n]); // has no oraclePaused()
    await assert.rejects(viem.deployContract("HeimdallStockFeed", [stock.address, plain.address, zeroAddress, 0, "x"]));
  });

  it("reports stale on a non-positive stock answer", async () => {
    const { adapter, stock } = await setup();
    await stock.write.set([-1n, BigInt(await networkHelpers.time.latest())]);
    assert.equal((await adapter.read.latestRoundData())[3], 0n);
  });

  it("rejects bad config", async () => {
    const { stock, token } = await setup();
    await assert.rejects(viem.deployContract("HeimdallStockFeed", [zeroAddress, token.address, zeroAddress, 0, "x"]));
    await assert.rejects(viem.deployContract("HeimdallStockFeed", [stock.address, token.address, stock.address, 0, "x"]));
  });

  it("reports stale when a multiplier took effect after the last price, and recovers on the next update", async () => {
    const { adapter, stock, token } = await setup(false);
    const now = BigInt(await networkHelpers.time.latest());
    await stock.write.set([134_00000000n, now]);
    await token.write.scheduleMultiplier([1_050000000000000000n, now + 100n]);    // a dividend, staged for later
    assert.ok((await adapter.read.latestRoundData())[3] > 0n, "a future multiplier changes nothing yet");
    await networkHelpers.time.increase(200);
    assert.equal((await adapter.read.latestRoundData())[3], 0n, "price predates the new multiplier");
    const later = BigInt(await networkHelpers.time.latest());
    await stock.write.set([140_70000000n, later]);                                  // feed publishes with the new multiplier
    const r = await adapter.read.latestRoundData();
    assert.equal(r[1], 140_70000000n);
    assert.ok(r[3] > 0n);
  });
});
