// Auto-Invest against a fork of Robinhood Chain mainnet: real USDG, real NVDA, real Uniswap v3 SwapRouter02,
// real Chainlink NVDA (24/7) and USDG/USD feeds through HeimdallStockFeed.
// Run: FORK=1 npx hardhat test nodejs test/fork/autoinvest.fork.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, parseAbi } from "viem";

const RUN = process.env.FORK === "1";
const USDG = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const NVDA = getAddress("0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC");
const ROUTER = getAddress("0xcaf681a66d020601342297493863e78c959e5cb2");
const POOL = getAddress("0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3");
const ERC20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

describe("Auto-Invest on a Robinhood Chain mainnet fork", { skip: !RUN && "set FORK=1" }, () => {
  it("buys real NVDA with real USDG on schedule, within the oracle bound", async () => {
    const { viem, networkHelpers } = await network.connect("robinhoodFork");
    const pc = await viem.getPublicClient();
    const [admin, user, keeper, fees] = await viem.getWalletClients();
    await networkHelpers.impersonateAccount(POOL);
    await networkHelpers.setBalance(POOL, 10n ** 18n);
    const poolSigner = await viem.getWalletClient(POOL);
    await poolSigner.writeContract({ address: USDG, abi: ERC20, functionName: "transfer", args: [user.account.address, 300_000_000n], chain: pc.chain, account: POOL });

    const feed = await viem.deployContract("HeimdallStockFeed", ["0x321A36e441DfBadA01Aa6f9884F14a344E133D1F", NVDA, "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2", 90_000, "NVDA / USDG"]);
    const ai = await viem.deployContract("HeimdallAutoInvest", [USDG, ROUTER, admin.account.address, fees.account.address]);
    await ai.write.setAsset([NVDA, feed.address, 500, 90_000, true]);
    await user.writeContract({ address: USDG, abi: ERC20, functionName: "approve", args: [ai.address, 300_000_000n], chain: pc.chain, account: user.account });
    await ai.write.createPlan([NVDA, 100_000_000n, 3_600, 3, 200], { account: user.account }); // 100 USDG hourly, ≤2% off oracle (forked oracle data cannot move a day ahead)

    for (let i = 0; i < 2; i++) {
      await ai.write.execute([0n], { account: keeper.account });
      await networkHelpers.time.increase(3_600);
    }
    const got = await pc.readContract({ address: NVDA, abi: ERC20, functionName: "balanceOf", args: [user.account.address] });
    const price = Number(await ai.read.oraclePrice([NVDA])) / 1e6;
    console.log(`      2 buys of 100 USDG → ${(Number(got) / 1e18).toFixed(4)} NVDA (oracle ${price.toFixed(2)} USDG)`);
    const expected = (2 * 99.75) / price;
    assert.ok(Number(got) / 1e18 > expected * 0.98, "filled within 2% of the oracle");
    assert.equal(await pc.readContract({ address: USDG, abi: ERC20, functionName: "balanceOf", args: [user.account.address] }), 100_000_000n);
  });
});
