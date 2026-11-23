import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress } from "viem";
import { riskSync } from "../../../apps/monitor/src/jobs.ts";

const { viem } = await network.create();
const A = getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const B = getAddress("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const C = getAddress("0xcccccccccccccccccccccccccccccccccccccccc");

/** A fake Shield that serves a given /v1/risk list. */
const shield = (entries: { address: string; level: number; flags: number }[]) =>
  (async () => new Response(JSON.stringify({ entries }), { status: 200 })) as unknown as typeof fetch;

describe("Risk Oracle sync (monitor riskSync against the real contract)", () => {
  it("adds, changes, clears and leaves pinned entries alone", async () => {
    const [safe, reporter] = await viem.getWalletClients();
    const pc = await viem.getPublicClient();
    const oracle = await viem.deployContract("HeimdallRiskOracle", [safe.account.address]);
    await oracle.write.setReporter([reporter.account.address, true]);
    const run = (list: { address: string; level: number; flags: number }[]) =>
      riskSync(reporter as never, pc as never, oracle.address, "http://shield", 0n, shield(list));

    let r = await run([{ address: A, level: 3, flags: 1 }, { address: B, level: 2, flags: 128 }]);
    assert.equal(r.changed, 2);
    assert.equal(await oracle.read.isBlocked([A]), true);
    assert.equal(await oracle.read.levelOf([B]), 2);

    // nothing to do when already in sync: no transaction
    r = await run([{ address: A, level: 3, flags: 1 }, { address: B, level: 2, flags: 128 }]);
    assert.equal(r.changed, 0);
    assert.equal(r.txs.length, 0);

    // A changes flags, B dropped from Shield's list (cleared onchain), C new
    r = await run([{ address: A, level: 3, flags: 65 }, { address: C, level: 3, flags: 2 }]);
    assert.equal(r.changed, 3);
    assert.deepEqual(await oracle.read.riskOf([A]).then((x) => [x[0], x[1]]), [3, 65]);
    assert.equal(await oracle.read.levelOf([B]), 0);
    assert.equal(await oracle.read.blockedCount(), 2n);

    // the Safe pins C clear (false positive); the next sync cannot re-block it
    await oracle.write.pin([C, 0, 0, true], { account: safe.account });
    r = await run([{ address: A, level: 3, flags: 65 }, { address: C, level: 3, flags: 2 }]);
    assert.equal(r.txs.length, 0); // no gas spent on a pinned entry
    assert.equal(await oracle.read.isBlocked([C]), false);
    assert.equal(await oracle.read.blockedCount(), 1n);
  });
});
