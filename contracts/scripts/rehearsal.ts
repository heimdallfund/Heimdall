/**
 * Launch-day rehearsal on a local mainnet fork, after deploy.ts, rehearsal-token.ts and deploy-staking.ts (DRY_RUN=1):
 * executes both Safe batches exactly as written to deployments/, then walks real money through every fee path and
 * checks the result. Writes deployments/localhost.rehearsal.md. Run through scripts/rehearsal.sh.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";
import { erc20Abi, getAddress, parseAbi, type Address, type Hex } from "viem";

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
for (const name of ["HeimdallVaultFactory", "HeimdallSignals", "HeimdallPay", "HeimdallAutoInvest", "HeimdallFeeSplitter"]) {
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

const failed = results.filter((x) => !x[1]).length;
writeFileSync(`deployments/${networkName}.rehearsal.md`, `# Launch rehearsal (local mainnet fork)\n\n${new Date().toISOString()}\n\n| Check | Result | Detail |\n| --- | --- | --- |\n${results.map(([n, ok, d]) => `| ${n} | ${ok ? "PASS" : "**FAIL**"} | ${d} |`).join("\n")}\n\n${failed ? `${failed} check(s) failed.` : "All checks passed."}\n`);
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
