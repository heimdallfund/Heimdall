/**
 * End-to-end on a local Hardhat node (`cd contracts && npx hardhat node`):
 * deploys the real contracts, funds a vault, runs the agent twice, then makes a signal flag a token as high risk.
 * Receipts come from a local test signer (Hardhat has no eth_simulateV1); on mainnet they come from the Shield API.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { toFunctionSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { runOnce, unsafeLocalReceipts, type SignalSource } from "../src/agent.js";
import { mockRouter } from "../src/router.js";

const ART = "/home/claude/heimdall/contracts/artifacts/contracts";
const find = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? find(join(d, f)) : [join(d, f)]));
const art = (n: string) => JSON.parse(readFileSync(find(ART).find((p) => p.endsWith(`/${n}.json`))!, "utf8")) as { abi: Abi; bytecode: Hex };

const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
] as const;
const [admin, manager, user] = KEYS.map((k) => privateKeyToAccount(k));
const shieldSigner = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const transport = http("http://127.0.0.1:8545");
const pc = createPublicClient({ chain: hardhat, transport }) as PublicClient;
const w = (acc: typeof admin) => createWalletClient({ chain: hardhat, transport, account: acc });

async function deploy(name: string, args: unknown[] = []) {
  const a = art(name);
  const hash = await w(admin).deployContract({ abi: a.abi, bytecode: a.bytecode, args });
  return (await pc.waitForTransactionReceipt({ hash })).contractAddress as Address;
}
async function send(acc: typeof admin, address: Address, name: string, functionName: string, args: unknown[]) {
  const hash = await w(acc).writeContract({ address, abi: art(name).abi, functionName, args } as never);
  await pc.waitForTransactionReceipt({ hash });
}
const read = <T,>(address: Address, name: string, functionName: string, args: unknown[] = []) => pc.readContract({ address, abi: art(name).abi, functionName, args } as never) as Promise<T>;

const usdg = await deploy("MockERC20", ["Global Dollar", "USDG", 6]);
const nvda = await deploy("MockERC20", ["NVIDIA", "NVDA", 18]);
const tsla = await deploy("MockERC20", ["Tesla", "TSLA", 18]);
const now = BigInt(Math.floor(Date.now() / 1000));
const fN = await deploy("MockFeed", [8, 100n * 10n ** 8n]);
const fT = await deploy("MockFeed", [8, 200n * 10n ** 8n]);
const router = await deploy("MockRouter");
for (const [a, b, r] of [[usdg, nvda, 10n ** 28n], [nvda, usdg, 100n * 10n ** 6n], [usdg, tsla, 5n * 10n ** 27n], [tsla, usdg, 200n * 10n ** 6n]] as const) await send(admin, router, "MockRouter", "setRate", [a, b, r]);
const deployer = await deploy("HeimdallVaultDeployer");
const factory = await deploy("HeimdallVaultFactory", [usdg, deployer, admin.address, admin.address, admin.address, shieldSigner.address]);
await send(admin, deployer, "HeimdallVaultDeployer", "setFactory", [factory]);
await send(admin, factory, "HeimdallVaultFactory", "setDefaults", [[{ target: router, selector: toFunctionSelector("swap(address,address,uint256,address)") }], [router], [{ token: nvda, feed: fN, heartbeat: 86400 }, { token: tsla, feed: fT, heartbeat: 86400 }]]);
await send(manager, factory, "HeimdallVaultFactory", "createVault", ["Guardian Balanced", "hGRD", 2500, 300]);
const vault = await read<Address>(factory, "HeimdallVaultFactory", "allVaults", [0n]);
await send(admin, usdg, "MockERC20", "mint", [user.address, 10_000n * 10n ** 6n]);
await send(user, usdg, "MockERC20", "approve", [vault, 10_000n * 10n ** 6n]);
await send(user, vault, "HeimdallVault", "deposit", [10_000n * 10n ** 6n, user.address]);
void now;

const cfg = { vault, usdg, router: mockRouter(router), targetsBps: { [nvda.toLowerCase()]: 3000, [tsla.toLowerCase()]: 3000 }, bandBps: 500, slippageBps: 100,
  signalIds: { tokenRisk: 0n }, signalPrices: { tokenRisk: 20_000n, stockPremium: 50_000n } };
const receipts = unsafeLocalReceipts({ address: shieldSigner.address, signTypedData: (d) => shieldSigner.signTypedData(d) }, hardhat.id);
const deps = { client: pc, manager: w(manager), receipts, log: (s: string) => console.log("  " + s) };
const positions = async () => {
  const [u, n, t, nav] = await Promise.all([read<bigint>(usdg, "MockERC20", "balanceOf", [vault]), read<bigint>(nvda, "MockERC20", "balanceOf", [vault]), read<bigint>(tsla, "MockERC20", "balanceOf", [vault]), read<bigint>(vault, "HeimdallVault", "totalAssets")]);
  console.log(`  → USDG ${Number(u) / 1e6} · NVDA ${Number(n) / 1e18} · TSLA ${Number(t) / 1e18} · NAV ${Number(nav) / 1e6}`);
};

console.log("cycle 1"); await runOnce(deps, cfg); await positions();
console.log("cycle 2"); await runOnce(deps, cfg); await positions();
const riskyTsla: SignalSource = { call: async <T,>(path: string) => ({ level: path.toLowerCase().includes(tsla.toLowerCase()) ? "high" : "low" }) as T };
console.log("cycle 3 (signal: TSLA high risk)"); await runOnce({ ...deps, signals: riskyTsla }, cfg); await positions();
