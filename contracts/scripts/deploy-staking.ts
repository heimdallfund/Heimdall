/**
 * Deploys $HEIM staking (USDG real yield) and the fee splitter, then writes a Safe batch that routes
 * protocol fees through the splitter: Signals treasury, factory fee recipient for new vaults, and every
 * existing vault's fee recipient.
 *
 *   HEIM=0x… STAKER_BPS=5000 npx hardhat run scripts/deploy-staking.ts --network robinhood
 *
 * Reads deployments/<network>.json (from scripts/deploy.ts) for the factory, Signals, Safe and treasury.
 */
import { network } from "hardhat";
import { readFileSync, writeFileSync } from "node:fs";
import { encodeFunctionData, getAddress, isAddress, parseAbi, type Address } from "viem";

const { viem, networkName } = await network.connect();
const pc = await viem.getPublicClient();
const dep = JSON.parse(readFileSync(`deployments/${networkName}.json`, "utf8")) as { adminSafe: Address; treasury: Address; contracts: { HeimdallVaultFactory: Address; HeimdallSignals: Address; HeimdallPay?: Address; HeimdallAutoInvest?: Address } };
const heim = process.env.HEIM;
if (!heim || !isAddress(heim)) throw new Error("set HEIM to the $HEIM token address");
const bps = Number(process.env.STAKER_BPS ?? 5000);
if (!(bps >= 0 && bps <= 8000)) throw new Error("STAKER_BPS must be 0–8000");
const usdg = getAddress(await pc.readContract({ address: dep.contracts.HeimdallSignals, abi: parseAbi(["function usdg() view returns (address)"]), functionName: "usdg" }));

// The staking contract only accepts rewards from the splitter (its immutable distributor), so the splitter comes
// first, then staking, then the splitter is pointed at staking and handed to the Safe (2-step).
const [me] = await viem.getWalletClients();
const splitter = await viem.deployContract("HeimdallFeeSplitter", [usdg, me.account.address, "0x0000000000000000000000000000000000000000", dep.treasury, 0]);
const staking = await viem.deployContract("HeimdallStaking", [getAddress(heim), usdg, splitter.address]);
const done = async (h: Promise<`0x${string}`>) => { const r = await pc.waitForTransactionReceipt({ hash: await h }); if (r.status !== "success") throw new Error("tx reverted"); };
await done(splitter.write.setConfig([staking.address, dep.treasury, bps]));
await done(splitter.write.transferOwnership([dep.adminSafe]));
// Holder status everywhere = $HEIM held + $HEIM staked, so staking never costs a holder their benefits.
const holderBalance = await viem.deployContract("HeimdallHolderBalance", [getAddress(heim), staking.address]);
console.log(`HeimdallStaking     ${staking.address}\nHeimdallFeeSplitter ${splitter.address} (stakers ${bps / 100}%)`);

const F = parseAbi(["function vaultAdmin() view returns (address)", "function shieldSigner() view returns (address)", "function vaultCount() view returns (uint256)", "function allVaults(uint256) view returns (address)", "function setRoles(address,address,address)"]);
const factory = dep.contracts.HeimdallVaultFactory;
const [admin, signer, count] = await Promise.all(["vaultAdmin", "shieldSigner", "vaultCount"].map((fn) => pc.readContract({ address: factory, abi: F, functionName: fn as never }))) as [Address, Address, bigint];
const vaults = await Promise.all(Array.from({ length: Number(count) }, (_, i) => pc.readContract({ address: factory, abi: F, functionName: "allVaults", args: [BigInt(i)] })));
const tx = (to: Address, abi: string, fn: string, args: unknown[]) => ({ to, value: "0", data: encodeFunctionData({ abi: parseAbi([abi]), functionName: fn as never, args: args as never }) });
const batch = {
  version: "1.0", chainId: String(await pc.getChainId()), createdAt: Date.now(),
  meta: { name: "Heimdall: route fees to $HEIM stakers", description: `Signals treasury, factory fee recipient and ${vaults.length} vault(s) → HeimdallFeeSplitter; $HEIM holder terms on the factory and Signals` },
  transactions: [
    tx(splitter.address, "function acceptOwnership()", "acceptOwnership", []),
    tx(dep.contracts.HeimdallSignals, "function setTreasury(address)", "setTreasury", [splitter.address]),
    tx(factory, "function setRoles(address,address,address)", "setRoles", [admin, splitter.address, signer]),
    ...vaults.map((v) => tx(v, "function setFeeRecipient(address)", "setFeeRecipient", [splitter.address])),
    ...(dep.contracts.HeimdallAutoInvest ? [tx(dep.contracts.HeimdallAutoInvest, "function setFee(uint16,address)", "setFee", [Number(process.env.AUTOINVEST_FEE_BPS ?? 25), splitter.address])] : []),
    ...(dep.contracts.HeimdallPay ? [tx(dep.contracts.HeimdallPay, "function setFee(uint16,address)", "setFee", [Number(process.env.PAY_FEE_BPS ?? 100), splitter.address])] : []),
    // $HEIM holder terms: vaults created from now on halve the platform fee for holder managers; Signals pays holders 95/5.
    // Set HOLDER_TERMS=0 to skip (for example when deploy.ts already set them).
    ...(process.env.HOLDER_TERMS === "0" ? [] : [
      tx(factory, "function setHolderTerms(address,uint256)", "setHolderTerms", [holderBalance.address, BigInt(process.env.HOLDER_MIN ?? "5000000000000000000000000")]),
      tx(dep.contracts.HeimdallSignals, "function setHolderTerms(address,uint256,uint16)", "setHolderTerms", [holderBalance.address, BigInt(process.env.HOLDER_MIN ?? "5000000000000000000000000"), Number(process.env.SIGNALS_HOLDER_FEE_BPS ?? 500)]),
    ]),
  ],
};
writeFileSync(`deployments/${networkName}.safe-route-fees.json`, JSON.stringify(batch, null, 2));
writeFileSync(`deployments/${networkName}.json`, JSON.stringify({ ...dep, contracts: { ...dep.contracts, HeimdallStaking: staking.address, HeimdallFeeSplitter: splitter.address, HeimdallHolderBalance: holderBalance.address } }, null, 2));
console.log(`\nwrote deployments/${networkName}.safe-route-fees.json — import it in the Safe.\nWeb env:\nNEXT_PUBLIC_STAKING_ADDRESS=${staking.address}\nNEXT_PUBLIC_SPLITTER_ADDRESS=${splitter.address}\nNEXT_PUBLIC_HEIM_HOLDER_ADDRESS=${holderBalance.address}\nShield env:\nHEIM_HOLDER_ADDRESS=${holderBalance.address}`);
console.log("Anyone can then call HeimdallFeeSplitter.distribute(USDG) (the monitor does it daily).");
