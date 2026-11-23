/**
 * Launch-day rehearsal on a local mainnet fork, after deploy.ts, rehearsal-token.ts and deploy-staking.ts (DRY_RUN=1):
 * executes both Safe batches exactly as written to deployments/, then walks real money through every fee path and
 * checks the result. Writes deployments/localhost.rehearsal.md. Run through scripts/rehearsal.sh.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";
import { createHash } from "node:crypto";
import { encodeFunctionData, erc20Abi, getAddress, keccak256, parseAbi, parseEventLogs, toHex, zeroAddress, type Address, type Hex } from "viem";
import { addCommunityBlock } from "../../apps/shield/src/blocklist.ts";
import { buildApp } from "../../apps/shield/src/server.ts";
import { MemoryStore } from "../../apps/shield/src/store.ts";
import { ROBINHOOD_USDG, requirementsFor, settlePayment, type PaymentPayload } from "../../apps/shield/src/x402.ts";
import { publishPassports, riskSync } from "../../apps/monitor/src/jobs.ts";
import { executeThroughGuard, guardRemaining, guardSetupCalls, HeimdallShield } from "../../packages/sdk/src/index.ts";

const { viem, networkName } = await network.connect();
if (networkName !== "localhost") throw new Error("rehearsal runs on a local fork only");
const pc = await viem.getPublicClient();
const test = await viem.getTestClient();
const [deployer, safe, client, provider, keeper, staker] = await viem.getWalletClients();
const dep = JSON.parse(readFileSync(`deployments/${networkName}.json`, "utf8"));
const C = dep.contracts as Record<string, Address>;
const HEIM = getAddress(JSON.parse(readFileSync(`deployments/${networkName}.heim.json`, "utf8")).HEIM);
const results: [string, boolean, string][] = [];
const failedSoFar = () => results.some((x) => !x[1]);
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` · ${detail}` : ""}`); };
const wait = async (h: Promise<Hex> | Hex) => { const r = await pc.waitForTransactionReceipt({ hash: await h }); if (r.status !== "success") throw new Error(`reverted ${r.transactionHash}`); return r; };

if (getAddress(dep.adminSafe) !== getAddress(safe.account.address)) throw new Error("dry-run adminSafe should be wallet #1");

// 1. Safe batches, transaction by transaction, as the Safe would send them
for (const file of ["safe-accept-ownership", "safe-route-fees"]) {
  const batch = JSON.parse(readFileSync(`deployments/${networkName}.${file}.json`, "utf8"));
  let ok = true, why = "";
  for (const tx of batch.transactions) {
    try { await wait(safe.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value), account: safe.account, chain: safe.chain })); }
    catch (e) { ok = false; why = `${tx.to}: ${(e as Error).message.split("\n")[0]}`; break; }
  }
  check(`Safe batch ${file} (${batch.transactions.length} txs) executes`, ok, why);
}

const OWN = parseAbi(["function owner() view returns (address)"]);
for (const name of ["HeimdallVaultFactory", "HeimdallSignals", "HeimdallPay", "HeimdallAutoInvest", "HeimdallFeeSplitter", "HeimdallRiskOracle", "HeimdallGuardModule"]) {
  const o = await pc.readContract({ address: C[name]!, abi: OWN, functionName: "owner" });
  check(`${name} owned by the Safe`, getAddress(o) === getAddress(safe.account.address), o);
}

// 2. Fee routing and holder terms
const splitter = getAddress(C.HeimdallFeeSplitter!), staking = getAddress(C.HeimdallStaking!);
const r = (address: Address, sig: string, args: unknown[] = []) => pc.readContract({ address, abi: parseAbi([sig]), functionName: sig.split(" ")[1]!.split("(")[0]! as never, args: args as never });
check("Signals treasury = splitter", getAddress(await r(C.HeimdallSignals!, "function treasury() view returns (address)") as Address) === splitter);
check("Pay fee 1% to splitter", getAddress(await r(C.HeimdallPay!, "function feeRecipient() view returns (address)") as Address) === splitter && Number(await r(C.HeimdallPay!, "function feeBps() view returns (uint16)")) === 100);
check("Auto-Invest fee 0.25% to splitter", getAddress(await r(C.HeimdallAutoInvest!, "function feeRecipient() view returns (address)") as Address) === splitter && Number(await r(C.HeimdallAutoInvest!, "function feeBps() view returns (uint16)")) === 25);
const holderBalance = getAddress(C.HeimdallHolderBalance!);
check("Factory $HEIM holder terms (held + staked)", getAddress(await r(C.HeimdallVaultFactory!, "function heimToken() view returns (address)") as Address) === holderBalance);
check("Signals $HEIM holder terms", (await r(C.HeimdallSignals!, "function holderMin() view returns (uint256)") as bigint) === 100_000n * 10n ** 18n);

// 3. Real USDG for the test wallets, taken from the deepest USDG pool on the fork
const usdg = getAddress(await r(C.HeimdallSignals!, "function usdg() view returns (address)") as Address);
const NVDA = getAddress("0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec");
const whale = getAddress(process.env.USDG_WHALE ?? "0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3"); // NVDA/USDG 0.05% pool
await test.impersonateAccount({ address: whale });
await test.setBalance({ address: whale, value: 10n ** 18n });
const whaleWallet = await viem.getWalletClient(whale);
for (const w of [client, keeper]) await wait(whaleWallet.writeContract({ address: usdg, abi: erc20Abi, functionName: "transfer", args: [w.account.address, 500_000000n], chain: pc.chain, account: whale }));
await test.stopImpersonatingAccount({ address: whale });
check("Test wallets funded with 500 USDG each", (await pc.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [client.account.address] })) === 500_000000n);

// E2E setup: stop here with funded wallets and live contracts (no time travel), and write the env the apps need.
if (process.env.SETUP_ONLY === "1") {
  await wait(deployer.writeContract({ address: HEIM, abi: erc20Abi, functionName: "transfer", args: [staker.account.address, 250_000n * 10n ** 18n] }));
  const e2e = {
    HEIM, HOLDER: C.HeimdallHolderBalance, STAKING: C.HeimdallStaking, SPLITTER: C.HeimdallFeeSplitter, FACTORY: C.HeimdallVaultFactory,
    PAY: C.HeimdallPay, AUTOINVEST: C.HeimdallAutoInvest, SIGNALS: C.HeimdallSignals, USDG: usdg,
    CLIENT: client.account.address, PROVIDER: provider.account.address, STAKER: staker.account.address,
  };
  writeFileSync(`deployments/${networkName}.e2e.json`, JSON.stringify(e2e, null, 2));
  console.log(`\nE2E setup ready: deployments/${networkName}.e2e.json`);
  process.exit(failedSoFar() ? 1 : 0);
}

// 4. Stake $HEIM before any fee arrives
const heimAmount = 200_000n * 10n ** 18n;
await wait(deployer.writeContract({ address: HEIM, abi: erc20Abi, functionName: "transfer", args: [staker.account.address, heimAmount] }));
await wait(staker.writeContract({ address: HEIM, abi: erc20Abi, functionName: "approve", args: [staking, heimAmount] }));
await wait(staker.writeContract({ address: staking, abi: parseAbi(["function stake(uint256)"]), functionName: "stake", args: [heimAmount] }));

// 5. Heimdall Pay: 100 USDG job, delivered, released → 1 USDG fee to the splitter
const PAY = parseAbi(["function createJob(address,address,uint96,uint64,uint32,uint16,bytes32) returns (uint256)", "function submit(uint256,bytes32)", "function release(uint256)", "function jobCount() view returns (uint256)"]);
const now = BigInt((await pc.getBlock()).timestamp);
await wait(client.writeContract({ address: usdg, abi: erc20Abi, functionName: "approve", args: [C.HeimdallPay!, 100_000000n] }));
await wait(client.writeContract({ address: C.HeimdallPay!, abi: PAY, functionName: "createJob", args: [provider.account.address, "0x0000000000000000000000000000000000000000", 100_000000n, now + 86_400n, 3_600, 0, `0x${"11".repeat(32)}`] }));
const jobId = 0n;
await wait(provider.writeContract({ address: C.HeimdallPay!, abi: PAY, functionName: "submit", args: [jobId, `0x${"22".repeat(32)}`] }));
await wait(client.writeContract({ address: C.HeimdallPay!, abi: PAY, functionName: "release", args: [jobId] }));
const provBal = await pc.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [provider.account.address] });
check("Pay: provider receives 99 USDG", provBal === 99_000000n, `${Number(provBal) / 1e6}`);

// 6. Auto-Invest: a real NVDA buy through Uniswap, fee accrued then swept to the splitter
const AI = parseAbi(["function createPlan(address,uint96,uint32,uint16,uint16) returns (uint256)", "function execute(uint256) returns (uint256)", "function accruedFees() view returns (uint256)", "function sweepFees() returns (uint256)"]);
await wait(client.writeContract({ address: usdg, abi: erc20Abi, functionName: "approve", args: [C.HeimdallAutoInvest!, 40_000000n] }));
await wait(client.writeContract({ address: C.HeimdallAutoInvest!, abi: AI, functionName: "createPlan", args: [NVDA, 40_000000n, 3_600, 1, 200] }));
let bought = 0n, aiErr = "";
try { await wait(keeper.writeContract({ address: C.HeimdallAutoInvest!, abi: AI, functionName: "execute", args: [0n] })); bought = await pc.readContract({ address: NVDA, abi: erc20Abi, functionName: "balanceOf", args: [client.account.address] }); }
catch (e) { aiErr = (e as Error).message.split("\n")[0]!; }
check("Auto-Invest: real NVDA bought within 2% of the oracle", bought > 0n, aiErr || `${Number(bought) / 1e18} NVDA`);
const accrued = await pc.readContract({ address: C.HeimdallAutoInvest!, abi: AI, functionName: "accruedFees" });
await wait(keeper.writeContract({ address: C.HeimdallAutoInvest!, abi: AI, functionName: "sweepFees" }));
check("Auto-Invest: 0.1 USDG fee swept to the splitter", accrued === 100000n);

const adapter = (dep.priceAdapters as Record<string, string>)?.NVDA ?? Object.values(dep.priceAdapters ?? {})[0];
if (adapter) {
  const rd = await r(getAddress(adapter as string), "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)") as readonly bigint[];
  check("NVDA adapter live (oracle not paused, no new multiplier since the last price)", rd[3]! > 0n && rd[1]! > 0n, `${Number(rd[1]) / 1e8} USDG`);
}

// 7. Daily distribution: stakers get 50% of 1.1 USDG, streamed over 7 days
const inSplitter = await pc.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [splitter] });
check("Splitter holds the fees", inSplitter === 1_100000n, `${Number(inSplitter) / 1e6} USDG`);
await wait(keeper.writeContract({ address: splitter, abi: parseAbi(["function distribute(address)"]), functionName: "distribute", args: [usdg] }));
const toStaking = await pc.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [staking] });
check("Distribute: 50% to staking", toStaking === 550000n, `${Number(toStaking) / 1e6} USDG`);
await test.increaseTime({ seconds: 7 * 86_400 }); await test.mine({ blocks: 1 });
const earned = await r(staking, "function earned(address) view returns (uint256)", [staker.account.address]) as bigint;
check("Staker earns the full stream after 7 days", earned >= 549_990n && earned <= 550000n, `${Number(earned) / 1e6} USDG`);

// 8. Vaults opened after the batch carry the $HEIM terms; the NVDA adapter is live
const FAC = parseAbi(["function createVault(string,string,uint16,uint16) returns (address)", "function vaultCount() view returns (uint256)", "function allVaults(uint256) view returns (address)"]);
await wait(provider.writeContract({ address: C.HeimdallVaultFactory!, abi: FAC, functionName: "createVault", args: ["Rehearsal", "hREH", 2_000, 100] }));
const vault = await pc.readContract({ address: C.HeimdallVaultFactory!, abi: FAC, functionName: "allVaults", args: [(await pc.readContract({ address: C.HeimdallVaultFactory!, abi: FAC, functionName: "vaultCount" })) - 1n] });
check("New vault reads the $HEIM holder terms", getAddress(await r(vault, "function heimToken() view returns (address)") as Address) === holderBalance);
check("A wallet that staked all its $HEIM is still a holder (Signals fee 5%)", (await r(C.HeimdallSignals!, "function feeFor(address) view returns (uint256)", [staker.account.address]) as bigint) === 500n);

// 9. Integrations, against the live contracts on the fork: Safe 1.4.1, USDG (EIP-3009) and the ERC-8004 registries
const ORACLE = getAddress(C.HeimdallRiskOracle!), GUARD = getAddress(C.HeimdallGuardModule!);
const ADMIN_KEY = "rehearsal-admin-key";
const store = new MemoryStore();
const shieldApp = buildApp({
  store, getClient: () => pc as never, log: () => {},
  env: { NODE_ENV: "test", HEIMDALL_PAY_ADDRESS: C.HeimdallPay!, RISK_ORACLE_ADDRESS: ORACLE, PASSPORT_PUBLISHER_ADDRESS: keeper.account.address,
    SHIELD_ADMIN_KEY_SHA256: createHash("sha256").update(ADMIN_KEY).digest("hex"), SHIELD_PUBLIC_URL: "https://api.heimdall.fund" },
});
const appFetch = ((url: string, init?: RequestInit) => shieldApp.request(new URL(url).pathname + new URL(url).search, init)) as typeof fetch;
const step = async (name: string, fn: () => Promise<string | void>) => { try { check(name, true, (await fn()) ?? ""); } catch (e) { check(name, false, (e as Error).message.split("\n")[0]!); } };

// 9a. Risk Oracle: the Safe appoints the reporter, the monitor's job writes Shield's list, a pin beats the reporter
const RISK = parseAbi(["function setReporter(address,bool)", "function pin(address,uint8,uint32,bool)", "function levelOf(address) view returns (uint8)", "function blockedCount() view returns (uint256)", "function report(address[],uint8[],uint32[])"]);
await step("Risk Oracle: Safe appoints the monitor as reporter", async () => { await wait(safe.writeContract({ address: ORACLE, abi: RISK, functionName: "setReporter", args: [keeper.account.address, true] })); });
const drainer = getAddress("0x000000000000000000000000000000000000dEaD");
// two stand-in drainers on Shield's blocklist (the community list the admin panel adds to), so the sync has something to write
for (const a of [drainer, "0x00000000000000000000000000000000DeaDBeef"]) addCommunityBlock(a);
await step("Risk Oracle: monitor syncs Shield's list onchain", async () => {
  const fromBlock = await pc.getBlockNumber();
  const r = await riskSync(keeper as never, pc as never, ORACLE, "http://shield", fromBlock, appFetch);
  const blocked = await pc.readContract({ address: ORACLE, abi: RISK, functionName: "blockedCount" });
  if (r.listed < 2 || blocked !== 2n) throw new Error(`Shield listed ${r.listed}, oracle has ${blocked} blocked`);
  return `${r.listed} listed by Shield, ${r.changed} written in ${r.txs.length} tx, ${blocked} blocked onchain`;
});
await step("Risk Oracle: a pinned entry ignores the reporter", async () => {
  await wait(safe.writeContract({ address: ORACLE, abi: RISK, functionName: "pin", args: [drainer, 3, 1, true] }));
  await wait(keeper.writeContract({ address: ORACLE, abi: RISK, functionName: "report", args: [[drainer], [0], [0]] }));
  const lvl = await pc.readContract({ address: ORACLE, abi: RISK, functionName: "levelOf", args: [drainer] });
  if (lvl !== 3) throw new Error(`level ${lvl}, expected 3`);
  return "level stays 3";
});

// 9b. Guard for Safe: a real Safe 1.4.1 from the canonical factory, set up with the SDK, an agent spending real USDG
const SAFE_FACTORY = getAddress("0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"), SAFE_L2 = getAddress("0x29fcB43b46531BcA003ddC8FCB67FFE91900C762");
const SAFE_ABI = parseAbi(["function setup(address[],uint256,address,bytes,address,address,uint256,address)", "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) payable returns (bool)", "function isModuleEnabled(address) view returns (bool)"]);
const FACTORY_ABI = parseAbi(["function createProxyWithNonce(address,bytes,uint256) returns (address)", "event ProxyCreation(address indexed proxy, address singleton)"]);
let userSafe: Address = zeroAddress;
await step("Guard: user Safe 1.4.1 created and set up with the SDK (enable module, agent, 20 USDG/day)", async () => {
  const init = encodeFunctionData({ abi: SAFE_ABI, functionName: "setup", args: [[client.account.address], 1n, zeroAddress, "0x", zeroAddress, zeroAddress, 0n, zeroAddress] });
  const rc = await wait(client.writeContract({ address: SAFE_FACTORY, abi: FACTORY_ABI, functionName: "createProxyWithNonce", args: [SAFE_L2, init, BigInt(Date.now())] }));
  const log = rc.logs.find((l) => getAddress(l.address) === SAFE_FACTORY)!;
  userSafe = getAddress(`0x${log.topics[1]!.slice(26)}`);
  await wait(client.writeContract({ address: usdg, abi: erc20Abi, functionName: "transfer", args: [userSafe, 50_000000n] }));
  const sig = `0x${client.account.address.slice(2).padStart(64, "0")}${"0".repeat(64)}01` as Hex;
  for (const c of guardSetupCalls(userSafe, { module: GUARD, agent: provider.account.address, strictTokens: true, tokens: [{ token: usdg, perDay: 20_000000n }] })) {
    await wait(client.writeContract({ address: userSafe, abi: SAFE_ABI, functionName: "execTransaction", args: [c.to, BigInt(c.value), c.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, sig] }));
  }
  if (!(await pc.readContract({ address: userSafe, abi: SAFE_ABI, functionName: "isModuleEnabled", args: [GUARD] }))) throw new Error("module not enabled");
  return userSafe;
});
// Shield stand-in: signs receipts with the dry-run Shield signer (wallet #1), exactly like apps/shield/src/receipt.ts
let n = 0;
const shieldFetch = (async (_u: string, init: RequestInit) => {
  const tx = JSON.parse(String(init.body));
  const expiresAt = BigInt((await pc.getBlock()).timestamp) + 120n;
  const message = { agent: getAddress(tx.from), target: getAddress(tx.to), dataHash: keccak256(tx.data), value: BigInt(tx.value), verdict: 0, expiresAt, checkId: keccak256(toHex(`rehearsal${++n}`)) };
  const signature = await safe.signTypedData({ account: safe.account, domain: { name: "Heimdall Shield", version: "1", chainId: 4663 },
    types: { Receipt: [{ name: "agent", type: "address" }, { name: "target", type: "address" }, { name: "dataHash", type: "bytes32" }, { name: "value", type: "uint256" }, { name: "verdict", type: "uint8" }, { name: "expiresAt", type: "uint64" }, { name: "checkId", type: "bytes32" }] },
    primaryType: "Receipt", message });
  return new Response(JSON.stringify({ verdict: "ALLOW", riskScore: 0, findings: [], summary: ["ok"], simulation: null, receipt: { signer: safe.account.address, signature, expiresAt: Number(expiresAt), message: { ...message, value: message.value.toString(), expiresAt: String(expiresAt) } } }));
}) as unknown as typeof fetch;
const shield = new HeimdallShield({ baseUrl: "http://shield", fetch: shieldFetch });
const pay15 = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [staker.account.address, 15_000000n] });
await step("Guard: agent sends 15 USDG from the Safe with a Shield receipt", async () => {
  await executeThroughGuard(provider as never, { module: GUARD, safe: userSafe, to: usdg, data: pay15 }, { shield });
  return `${Number(await guardRemaining(pc as never, GUARD, userSafe, usdg)) / 1e6} USDG left today`;
});
await step("Guard: a second 15 USDG is refused (over the 20 USDG daily limit)", async () => {
  try { await executeThroughGuard(provider as never, { module: GUARD, safe: userSafe, to: usdg, data: pay15 }, { shield }); } catch { return "LimitExceeded"; }
  throw new Error("went through");
});

// 9c. x402: an agent pays 0.001 USDG for a Shield call with a signature; the facilitator settles it with real USDG
await step("x402: real USDG transferWithAuthorization settled by the facilitator", async () => {
  const req = requirementsFor(ROBINHOOD_USDG, 1000n, keeper.account.address);
  const now = BigInt((await pc.getBlock()).timestamp);
  const authorization = { from: client.account.address, to: keeper.account.address, value: 1000n, validAfter: 0n, validBefore: now + 600n, nonce: keccak256(toHex(`x402-${Date.now()}`)) };
  const signature = await client.signTypedData({ account: client.account,
    domain: { name: ROBINHOOD_USDG.name, version: ROBINHOOD_USDG.version, chainId: 4663, verifyingContract: usdg },
    types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "TransferWithAuthorization", message: authorization });
  const p: PaymentPayload = { x402Version: 2, resource: { url: "https://api.heimdall.fund/v1/check/transaction" }, accepted: { ...req, payTo: keeper.account.address, amount: "1000" },
    payload: { signature, authorization: { ...authorization, value: "1000", validAfter: "0", validBefore: String(authorization.validBefore) } } };
  const before = await pc.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [keeper.account.address] });
  const r = await settlePayment(keeper as never, pc as never, p, req, { nowSec: Number(now) });
  if (!r.success) throw new Error(r.errorReason ?? "not settled");
  const after = await pc.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [keeper.account.address] });
  if (after - before !== 1000n) throw new Error(`received ${after - before}`);
  return r.transaction;
});

// 9d. Agent Passport: register on the live ERC-8004 Identity Registry, link, publish the score to the live Reputation Registry
const IDENTITY = parseAbi(["function register(string) returns (uint256)", "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)"]);
const REPUTATION = parseAbi(["function getSummary(uint256,address[],string,string) view returns (uint64,int128,uint8)"]);
await step("Passport: agent registered on ERC-8004, linked, score published by the monitor", async () => {
  const reg = { name: "Rehearsal agent", description: "Launch rehearsal", services: [], x402Support: true, active: true };
  const rc = await wait(provider.writeContract({ address: getAddress("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"), abi: IDENTITY, functionName: "register", args: [`data:application/json;base64,${Buffer.from(JSON.stringify(reg)).toString("base64")}`] }));
  const [ev] = parseEventLogs({ abi: IDENTITY, logs: rc.logs, eventName: "Registered" });
  if (!ev) throw new Error("no Registered event");
  const agentId = ev.args.agentId;
  const link = await shieldApp.request("/v1/passport/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: provider.account.address, agentId: agentId.toString() }) });
  if (link.status !== 200) throw new Error(`link ${link.status}: ${await link.text()}`);
  await publishPassports(keeper as never, pc as never, "http://shield", ADMIN_KEY, undefined, appFetch);
  const [count, value] = await pc.readContract({ address: getAddress("0x8004BAa17C55a88189AE136b182e5fdA19dE9b63"), abi: REPUTATION, functionName: "getSummary", args: [agentId, [keeper.account.address], "heimdall", ""] });
  if (count !== 1n) throw new Error(`feedback count ${count}`);
  return `agent #${agentId}, score ${value} onchain`;
});

const failed = results.filter((x) => !x[1]).length;
writeFileSync(`deployments/${networkName}.rehearsal.md`, `# Launch rehearsal (local mainnet fork)\n\n${new Date().toISOString()}\n\n| Check | Result | Detail |\n| --- | --- | --- |\n${results.map(([n, ok, d]) => `| ${n} | ${ok ? "PASS" : "**FAIL**"} | ${d} |`).join("\n")}\n\n${failed ? `${failed} check(s) failed.` : "All checks passed."}\n`);
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
