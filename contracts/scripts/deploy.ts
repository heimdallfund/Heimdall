/**
 * Config-driven deploy of the Heimdall contracts to Robinhood Chain.
 *
 *   DEPLOY_CONFIG=deploy/robinhood.config.json npx hardhat run scripts/deploy.ts --network robinhood
 *   (dry run on a local mainnet fork: DRY_RUN=1 npx hardhat run scripts/deploy.ts --network robinhoodFork)
 *
 * Flow: preflight checks → deploy Deployer, Factory, Signals with the deployer key as temporary owner →
 * configure defaults, caps and $HEIM terms → start a 2-step ownership transfer to the Safe →
 * write deployments/<network>.json and a Safe Transaction Builder batch that accepts ownership.
 * Vault ownership is never with the deployer: every vault is owned by `adminSafe` from creation.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";
import { encodeFunctionData, getAddress, isAddress, parseAbi, toFunctionSelector, type Address } from "viem";

type Config = {
  usdg: string; adminSafe: string; treasury: string; shieldSigner: string;
  calls: { name: string; target: string; signature: string }[];
  spenders: string[];
  usdgUsdFeed: string; usdgFeedMaxAge: number; poolFee?: number;
  assets: { symbol: string; token: string; chainlinkFeed: string; heartbeat: number; poolFee?: number }[];
  caps: { tradeBps: number; lossBps: number; dailyLossBps: number; depositCap: string };
  heim: { token: string; holderMin: string; signalsHolderFeeBps: number };
};

const DRY = process.env.DRY_RUN === "1";
const cfgPath = process.env.DEPLOY_CONFIG ?? (DRY ? "deploy/robinhood.config.example.json" : "deploy/robinhood.config.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Config;
const { viem, networkName } = await network.connect();
const pc = await viem.getPublicClient();
const [wallet, standIn] = await viem.getWalletClients();
const me = getAddress(wallet.account.address);
const wait = async (hash: Promise<`0x${string}`>) => {
  const r = await pc.waitForTransactionReceipt({ hash: await hash });
  if (r.status !== "success") throw new Error(`transaction ${r.transactionHash} reverted`);
};

const addr = (v: string, label: string): Address => {
  if (DRY && (!v || v.startsWith("<SET"))) return getAddress(standIn.account.address); // dry run: stand-in for unset roles
  if (!isAddress(v)) throw new Error(`config ${label}: not an address (${v})`);
  return getAddress(v);
};

// ── preflight ──────────────────────────────────────────────
const chainId = await pc.getChainId();
if (!DRY && chainId !== 4663) throw new Error(`expected Robinhood Chain (4663), got ${chainId}`);
const usdg = addr(cfg.usdg, "usdg");
const admin = addr(cfg.adminSafe, "adminSafe");
const treasury = addr(cfg.treasury, "treasury");
const signer = addr(cfg.shieldSigner, "shieldSigner");
const hasCode = async (a: Address) => ((await pc.getCode({ address: a })) ?? "0x").length > 2;
for (const [label, a] of [["usdg", usdg], ["adminSafe", admin]] as const) {
  if (!DRY && !(await hasCode(a))) throw new Error(`${label} ${a} has no code (a Safe must be deployed first)`);
}
const calls = cfg.calls.map((c) => ({ target: addr(c.target, c.name), selector: toFunctionSelector(c.signature) }));
for (const c of calls) if (!(await hasCode(c.target))) throw new Error(`call target ${c.target} has no code`);
const spenders = cfg.spenders.map((s) => addr(s, "spender"));
const FEED = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"]);
const TOKEN = parseAbi(["function oraclePaused() view returns (bool)", "function symbol() view returns (string)"]);
const usdgFeed = addr(cfg.usdgUsdFeed, "usdgUsdFeed");
const now = Math.floor(Date.now() / 1000);
const checkFeed = async (feed: Address, maxAge: number, label: string) => {
  const [, answer, , updatedAt] = await pc.readContract({ address: feed, abi: FEED, functionName: "latestRoundData" });
  const age = now - Number(updatedAt);
  if (answer <= 0n || age > maxAge) throw new Error(`feed ${label} is stale or invalid (age ${age}s)`);
};
if (!DRY || (await hasCode(usdgFeed))) await checkFeed(usdgFeed, cfg.usdgFeedMaxAge, "USDG/USD");
const preAssets: { symbol: string; token: Address; chainlinkFeed: Address; heartbeat: number; poolFee: number }[] = [];
for (const a of cfg.assets) {
  const token = addr(a.token, `${a.symbol}.token`), chainlinkFeed = addr(a.chainlinkFeed, `${a.symbol}.chainlinkFeed`);
  if (DRY && !(await hasCode(chainlinkFeed))) { console.log(`  dry run: skipping asset ${a.symbol} (feed not on this network)`); continue; }
  await checkFeed(chainlinkFeed, a.heartbeat, a.symbol);
  const sym = await pc.readContract({ address: token, abi: TOKEN, functionName: "symbol" });
  if (sym !== a.symbol) throw new Error(`token ${token} symbol is ${sym}, config says ${a.symbol}`);
  if (await pc.readContract({ address: token, abi: TOKEN, functionName: "oraclePaused" })) throw new Error(`${a.symbol} oracle is paused (corporate action) — retry later`);
  preAssets.push({ symbol: a.symbol, token, chainlinkFeed, heartbeat: a.heartbeat, poolFee: a.poolFee ?? cfg.poolFee ?? 500 });
}
const bal = await pc.getBalance({ address: me });
console.log(`network ${networkName} (${chainId}) · deployer ${me} · ${Number(bal) / 1e18} ETH`);
if (bal === 0n) throw new Error("deployer has no ETH for gas");

// ── deploy ─────────────────────────────────────────────────
const deployer = await viem.deployContract("HeimdallVaultDeployer");
const factory = await viem.deployContract("HeimdallVaultFactory", [usdg, deployer.address, me, admin, treasury, signer]);
await wait(deployer.write.setFactory([factory.address]));
const signals = await viem.deployContract("HeimdallSignals", [usdg, me, treasury]);
const pay = await viem.deployContract("HeimdallPay", [usdg, me, treasury]);
const uniRouter = calls[0]?.target ?? addr("0xcaf681a66d020601342297493863e78c959e5cb2", "router");
const autoInvest = await viem.deployContract("HeimdallAutoInvest", [usdg, uniRouter, me, treasury]);
console.log(`HeimdallVaultDeployer ${deployer.address}\nHeimdallVaultFactory  ${factory.address}\nHeimdallSignals       ${signals.address}\nHeimdallPay           ${pay.address}\nHeimdallAutoInvest    ${autoInvest.address}`);

// ── price adapters: Chainlink stock feed ÷ USDG/USD, stale while the token's oracle is paused ──
const assets: { token: Address; feed: Address; heartbeat: number }[] = [];
const adapters: Record<string, Address> = {};
for (const a of preAssets) {
  const adapter = await viem.deployContract("HeimdallStockFeed", [a.chainlinkFeed, a.token, usdgFeed, cfg.usdgFeedMaxAge, `${a.symbol} / USDG`]);
  const [, px, , upd] = await adapter.read.latestRoundData();
  if (upd === 0n || px <= 0n) throw new Error(`adapter for ${a.symbol} reports stale right after deploy`);
  console.log(`HeimdallStockFeed ${a.symbol.padEnd(5)} ${adapter.address} · ${(Number(px) / 1e8).toFixed(2)} USDG`);
  adapters[a.symbol] = adapter.address;
  assets.push({ token: a.token, feed: adapter.address, heartbeat: a.heartbeat });
}

// ── configure (deployer is still owner) ────────────────────
for (const a of preAssets) await wait(autoInvest.write.setAsset([a.token, adapters[a.symbol], a.poolFee, a.heartbeat, true]));
await wait(factory.write.setDefaults([calls, spenders, assets]));
await wait(factory.write.setCaps([cfg.caps.tradeBps, cfg.caps.lossBps, cfg.caps.dailyLossBps, BigInt(cfg.caps.depositCap)]));
if (cfg.heim.token && !cfg.heim.token.startsWith("<SET")) {
  const heim = addr(cfg.heim.token, "heim.token");
  await wait(factory.write.setHolderTerms([heim, BigInt(cfg.heim.holderMin)]));
  await wait(signals.write.setHolderTerms([heim, BigInt(cfg.heim.holderMin), cfg.heim.signalsHolderFeeBps]));
}

// ── hand over to the Safe (2-step) ─────────────────────────
await wait(factory.write.transferOwnership([admin]));
await wait(signals.write.transferOwnership([admin]));
await wait(pay.write.transferOwnership([admin]));
await wait(autoInvest.write.transferOwnership([admin]));

// ── checks ─────────────────────────────────────────────────
const [dCalls, dSpenders, dAssets] = await factory.read.getDefaults();
if (dCalls.length !== calls.length || dSpenders.length !== spenders.length || dAssets.length !== assets.length) throw new Error("defaults mismatch");
for (const c of [factory, signals, pay, autoInvest]) if (getAddress(await c.read.pendingOwner()) !== admin) throw new Error("ownership transfer not pending");
if (getAddress(await factory.read.vaultAdmin()) !== admin) throw new Error("vault admin mismatch");

// ── outputs ────────────────────────────────────────────────
const block = await pc.getBlockNumber();
const out = { network: networkName, chainId, block: block.toString(), deployer: me, adminSafe: admin, treasury, shieldSigner: signer,
  contracts: { HeimdallVaultDeployer: deployer.address, HeimdallVaultFactory: factory.address, HeimdallSignals: signals.address, HeimdallPay: pay.address, HeimdallAutoInvest: autoInvest.address }, priceAdapters: adapters };
mkdirSync("deployments", { recursive: true });
writeFileSync(`deployments/${networkName}.json`, JSON.stringify(out, null, 2));
const accept = encodeFunctionData({ abi: parseAbi(["function acceptOwnership()"]), functionName: "acceptOwnership" });
const batch = { version: "1.0", chainId: String(chainId), createdAt: Date.now(), meta: { name: "Heimdall: accept ownership", description: "Safe accepts ownership of HeimdallVaultFactory, HeimdallSignals, HeimdallPay and HeimdallAutoInvest" },
  transactions: [factory.address, signals.address, pay.address, autoInvest.address].map((to) => ({ to, value: "0", data: accept })) };
writeFileSync(`deployments/${networkName}.safe-accept-ownership.json`, JSON.stringify(batch, null, 2));
console.log(`\nwrote deployments/${networkName}.json and deployments/${networkName}.safe-accept-ownership.json`);
console.log(`\nNext: import the Safe batch in Transaction Builder and execute it.\nWeb env:\nNEXT_PUBLIC_FACTORY_ADDRESS=${factory.address}\nNEXT_PUBLIC_SIGNALS_ADDRESS=${signals.address}\nNEXT_PUBLIC_PAY_ADDRESS=${pay.address}\nNEXT_PUBLIC_AUTOINVEST_ADDRESS=${autoInvest.address}`);
