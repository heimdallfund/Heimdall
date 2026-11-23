/** Local end-to-end fixture: mocks + factory + signals + one funded vault. Run against `npx hardhat node`. */
import { network } from "hardhat";
import { encodeFunctionData, keccak256, parseAbi, toHex } from "viem";
import { toFunctionSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const { viem } = await network.create({ network: "localhost" });
const [admin, manager, user, provider] = await viem.getWalletClients();
const pc = await viem.getPublicClient();
const shield = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

const usdg = await viem.deployContract("MockERC20", ["Global Dollar", "USDG", 6]);
const nvda = await viem.deployContract("MockERC20", ["NVIDIA", "NVDA", 18]);
const feed = await viem.deployContract("MockFeed", [8, 100n * 10n ** 8n]);
const router = await viem.deployContract("MockRouter");
await router.write.setRate([usdg.address, nvda.address, 10n ** 28n]);
const deployer = await viem.deployContract("HeimdallVaultDeployer");
const factory = await viem.deployContract("HeimdallVaultFactory", [usdg.address, deployer.address, admin.account.address, admin.account.address, admin.account.address, shield.address]);
await deployer.write.setFactory([factory.address]);
await factory.write.setDefaults([[{ target: router.address, selector: toFunctionSelector("swap(address,address,uint256,address)") }], [router.address], [{ token: nvda.address, feed: feed.address, heartbeat: 86400 * 365 }]]);
await factory.write.createVault(["Mag7 Momentum", "hMAG7", 2500, 300], { account: manager.account });
const vault = await viem.getContractAt("HeimdallVault", await factory.read.allVaults([0n]));
await usdg.write.mint([user.account.address, 50_000n * 10n ** 6n]);
await usdg.write.approve([vault.address, 50_000n * 10n ** 6n], { account: user.account });
await vault.write.deposit([10_000n * 10n ** 6n, user.account.address], { account: user.account });

const chainId = await pc.getChainId();
const types = { Receipt: [{ name: "agent", type: "address" }, { name: "target", type: "address" }, { name: "dataHash", type: "bytes32" }, { name: "value", type: "uint256" }, { name: "verdict", type: "uint8" }, { name: "expiresAt", type: "uint64" }, { name: "checkId", type: "bytes32" }] } as const;
let n = 0;
async function exec(target: `0x${string}`, data: `0x${string}`) {
  const message = { agent: vault.address, target, dataHash: keccak256(data), value: 0n, verdict: 0, expiresAt: BigInt(Math.floor(Date.now() / 1000) + 600), checkId: keccak256(toHex(`demo-${++n}`)) };
  const sig = await shield.signTypedData({ domain: { name: "Heimdall Shield", version: "1", chainId }, types, primaryType: "Receipt", message });
  await vault.write.execute([target, data, message, sig], { account: manager.account });
}
await exec(usdg.address, encodeFunctionData({ abi: parseAbi(["function approve(address,uint256)"]), functionName: "approve", args: [router.address, 10n ** 12n] }));
await exec(router.address, encodeFunctionData({ abi: parseAbi(["function swap(address,address,uint256,address)"]), functionName: "swap", args: [usdg.address, nvda.address, 2_000n * 10n ** 6n, vault.address] }));
await feed.write.set([112n * 10n ** 8n, BigInt(Math.floor(Date.now() / 1000))]); // NVDA +12%

const signals = await viem.deployContract("HeimdallSignals", [usdg.address, admin.account.address, admin.account.address]);
await signals.write.register([JSON.stringify({ name: "Stock token premium vs. Nasdaq", category: "stocks", description: "Premium or discount of each stock token against its last traded price.", endpoint: "https://signals.example/premium" }), 50_000n, provider.account.address], { account: provider.account });

console.log(JSON.stringify({ factory: factory.address, signals: signals.address, vault: vault.address, usdg: usdg.address }));
