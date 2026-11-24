// Integration test against a fork of Robinhood Chain mainnet: real USDG (Paxos), real NVDA stock token,
// real Uniswap v3 SwapRouter02 and the real USDG/NVDA 0.05% pool.
// Run: FORK=1 npx hardhat test nodejs test/fork/mainnet.fork.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodeFunctionData, getAddress, keccak256, parseAbi, toFunctionSelector, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const RUN = process.env.FORK === "1";
const USDG = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const NVDA = getAddress("0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC");
const ROUTER = getAddress("0xcaf681a66d020601342297493863e78c959e5cb2"); // Uniswap SwapRouter02
const POOL = getAddress("0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3"); // USDG/NVDA 0.05%
const ERC20 = parseAbi(["function approve(address,uint256) returns (bool)", "function increaseApproval(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const ROUTER_ABI = parseAbi(["struct P { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }", "function exactInputSingle(P params) payable returns (uint256 amountOut)"]);
const POOL_ABI = parseAbi(["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)"]);
const EXACT_IN = toFunctionSelector("exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))");
const TYPES = { Receipt: [{ name: "agent", type: "address" }, { name: "target", type: "address" }, { name: "dataHash", type: "bytes32" }, { name: "value", type: "uint256" }, { name: "verdict", type: "uint8" }, { name: "expiresAt", type: "uint64" }, { name: "checkId", type: "bytes32" }] } as const;
const U = (n: number) => BigInt(Math.round(n * 1e6));

describe("Robinhood Chain mainnet fork", { skip: !RUN && "set FORK=1 to run against a mainnet fork" }, () => {
  it("vault trades real USDG → NVDA on Uniswap through Shield receipts, enforces limits, exits in kind", async () => {
    const { viem, networkHelpers } = await network.connect("robinhoodFork");
    const pc = await viem.getPublicClient();
    const [admin, manager, user] = await viem.getWalletClients();
    const shield = privateKeyToAccount(generatePrivateKey());
    const chainId = await pc.getChainId();
    assert.equal(chainId, 4663);

    // fund the user with real USDG from the pool's balance (impersonation, fork only)
    await networkHelpers.impersonateAccount(POOL);
    await networkHelpers.setBalance(POOL, 10n ** 18n);
    const poolSigner = await viem.getWalletClient(POOL);
    await poolSigner.writeContract({ address: USDG, abi: ERC20, functionName: "transfer", args: [user.account.address, U(5_000)], chain: pc.chain, account: POOL });

    // Real Chainlink feeds on Robinhood Chain: NVDA (24/7) in USD, divided by USDG/USD, paused-aware
    const NVDA_FEED = getAddress("0x321A36e441DfBadA01Aa6f9884F14a344E133D1F");
    const USDG_FEED = getAddress("0x61B7e5650328764B076A108EFF5fa7282a1B9aD2");
    const feed = await viem.deployContract("HeimdallStockFeed", [NVDA_FEED, NVDA, USDG_FEED, 90_000, "NVDA / USDG"]);
    const [, px, , upd] = await feed.read.latestRoundData();
    assert.ok(upd > 0n, "live NVDA feed must be fresh on the fork");
    const [sqrtP] = await pc.readContract({ address: POOL, abi: POOL_ABI, functionName: "slot0" });
    const poolPx = 1 / (((Number(sqrtP) / 2 ** 96) ** 2) * 1e6 / 1e18);
    console.log(`      Chainlink NVDA: ${(Number(px) / 1e8).toFixed(2)} USDG · Uniswap pool: ${poolPx.toFixed(2)} USDG`);

    const deployer = await viem.deployContract("HeimdallVaultDeployer");
    const factory = await viem.deployContract("HeimdallVaultFactory", [USDG, deployer.address, admin.account.address, admin.account.address, admin.account.address, shield.address]);
    await deployer.write.setFactory([factory.address]);
    await factory.write.setDefaults([[{ target: ROUTER, selector: EXACT_IN }], [ROUTER], [{ token: NVDA, feed: feed.address, heartbeat: 86_400 }]]);
    await factory.write.createVault(["Guardian Balanced", "hGRD", 2500, 300], { account: manager.account });
    const vault = await viem.getContractAt("HeimdallVault", await factory.read.allVaults([0n]));

    const usdg = await viem.getContractAt("MockERC20", USDG); // ERC-20 interface only
    await usdg.write.approve([vault.address, U(5_000)], { account: user.account });
    await vault.write.deposit([U(5_000), user.account.address], { account: user.account });
    assert.equal(await vault.read.totalAssets(), U(5_000));

    let n = 0;
    const exec = async (target: Address, data: Hex) => {
      const block = await pc.getBlock();
      const message = { agent: vault.address, target, dataHash: keccak256(data), value: 0n, verdict: 0, expiresAt: block.timestamp + 120n, checkId: keccak256(toHex(`fork-${++n}`)) };
      const signature = await shield.signTypedData({ domain: { name: "Heimdall Shield", version: "1", chainId }, types: TYPES, primaryType: "Receipt", message });
      return vault.write.execute([target, data, message, signature], { account: manager.account });
    };

    // Paxos USDG supports increaseApproval: the vault must reject it (C-01)
    const grant = encodeFunctionData({ abi: ERC20, functionName: "increaseApproval", args: [admin.account.address, U(1)] });
    await viem.assertions.revertWithCustomError(exec(USDG, grant), vault, "CallNotAllowed");

    // approve the real router, then swap 1,000 USDG for NVDA on the real pool
    await exec(USDG, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, U(1_000_000)] }));
    const swap = (amountIn: bigint, recipient: Address = vault.address) => encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: USDG, tokenOut: NVDA, fee: 500, recipient, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] });
    await exec(ROUTER, swap(U(1_000)));
    const nvdaBal = await pc.readContract({ address: NVDA, abi: ERC20, functionName: "balanceOf", args: [vault.address] });
    const nav = await vault.read.totalAssets();
    console.log(`      bought ${(Number(nvdaBal) / 1e18).toFixed(4)} NVDA; NAV ${(Number(nav) / 1e6).toFixed(2)} USDG`);
    assert.ok(nvdaBal > 0n);
    assert.ok(nav > U(4_975), `swap cost should be fees + impact only, NAV ${nav}`);

    // limits: a 2,000 USDG trade is above 25% of NAV; a swap paying anyone but the vault is refused outright,
    // even a small one that would fit inside the 3% loss limit (review 6, R6-01)
    await viem.assertions.revertWithCustomError(exec(ROUTER, swap(U(2_000))), vault, "TradeTooLarge");
    await viem.assertions.revertWithCustomError(exec(ROUTER, swap(U(500), admin.account.address)), vault, "CallNotAllowed");
    await viem.assertions.revertWithCustomError(exec(ROUTER, swap(U(100), admin.account.address)), vault, "CallNotAllowed");
    // routers only accept the reviewed selector
    const multicall = encodeFunctionData({ abi: parseAbi(["function multicall(bytes[] data) payable returns (bytes[])"]), functionName: "multicall", args: [[]] });
    await viem.assertions.revertWithCustomError(exec(ROUTER, multicall), vault, "CallNotAllowed");

    // in-kind exit pays real USDG and real NVDA
    const shares = await vault.read.balanceOf([user.account.address]);
    const before = await pc.readContract({ address: USDG, abi: ERC20, functionName: "balanceOf", args: [user.account.address] });
    await vault.write.redeemInKind([shares, user.account.address, user.account.address], { account: user.account });
    const gotUsdg = (await pc.readContract({ address: USDG, abi: ERC20, functionName: "balanceOf", args: [user.account.address] })) - before;
    const gotNvda = await pc.readContract({ address: NVDA, abi: ERC20, functionName: "balanceOf", args: [user.account.address] });
    console.log(`      in-kind exit: ${(Number(gotUsdg) / 1e6).toFixed(2)} USDG + ${(Number(gotNvda) / 1e18).toFixed(4)} NVDA`);
    // the exit first crystallises any performance fee (when the oracle values the NVDA above what the pool charged),
    // so the user gets their slice net of fee shares; what is left belongs to the manager and the fee recipient
    const left = await vault.read.totalSupply();
    const feeHolders = (await vault.read.balanceOf([manager.account.address])) + (await vault.read.balanceOf([await vault.read.feeRecipient()]));
    assert.equal(left, feeHolders);
    assert.ok(gotUsdg <= U(4_000) && gotUsdg >= U(3_990), `in-kind USDG ${gotUsdg}`);
    assert.ok(gotNvda <= nvdaBal && gotNvda * 1000n >= nvdaBal * 997n, `in-kind NVDA ${gotNvda}`);
  });
});
