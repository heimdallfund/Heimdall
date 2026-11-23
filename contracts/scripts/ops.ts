/**
 * Builds Safe Transaction Builder batches for admin and emergency actions (the Safe owns every vault).
 * Nothing is sent: import the JSON at app.safe.global → Transaction Builder, review, sign, execute.
 *
 *   OP=pause        [VAULTS=all|0xA,0xB]                     npx hardhat run scripts/ops.ts --network robinhood
 *   OP=unpause      [VAULTS=…]
 *   OP=deposit-cap  CAP=25000000000 [VAULTS=…]               (raw USDG units, 6 decimals)
 *   OP=signer       NEW_SIGNER=0x… OLD_SIGNER=0x… [VAULTS=…]  (adds the new Shield signer, removes the old)
 *   OP=disable-call TARGET=0x… SIGNATURE="exactInput(...)" [VAULTS=…]
 *   OP=set-feed     TOKEN=0x… FEED=0x… HEARTBEAT=86400 [VAULTS=…]
 *   OP=revoke       TOKEN=0x… SPENDER=0x… [VAULTS=…]
 * Requires FACTORY (or deployments/<network>.json).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";
import { encodeFunctionData, getAddress, toFunctionSelector, type Address, type Hex } from "viem";

const { viem, networkName } = await network.connect();
const pc = await viem.getPublicClient();
const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing ${k}`); return v; };
const dep = `deployments/${networkName}.json`;
const factoryAddr = getAddress(process.env.FACTORY ?? (existsSync(dep) ? JSON.parse(readFileSync(dep, "utf8")).contracts.HeimdallVaultFactory : env("FACTORY")));
const factory = await viem.getContractAt("HeimdallVaultFactory", factoryAddr);
const count = Number(await factory.read.vaultCount());
const all = await Promise.all(Array.from({ length: count }, (_, i) => factory.read.allVaults([BigInt(i)])));
const sel = process.env.VAULTS && process.env.VAULTS !== "all" ? process.env.VAULTS.split(",").map((v) => getAddress(v.trim())) : all;
const vault = await viem.getContractAt("HeimdallVault", factoryAddr); // ABI holder
const abi = vault.abi;
const call = (to: Address, functionName: string, args: unknown[] = []) => ({ to, value: "0", data: encodeFunctionData({ abi, functionName: functionName as never, args: args as never }) as Hex });

const op = env("OP");
const txs = sel.flatMap((v) => {
  switch (op) {
    case "pause": return [call(v, "pause")];
    case "unpause": return [call(v, "unpause")];
    case "deposit-cap": return [call(v, "setDepositCap", [BigInt(env("CAP"))])];
    case "signer": return [call(v, "setShieldSigner", [getAddress(env("NEW_SIGNER")), true]), call(v, "setShieldSigner", [getAddress(env("OLD_SIGNER")), false])];
    case "disable-call": return [call(v, "setCall", [getAddress(env("TARGET")), toFunctionSelector(env("SIGNATURE")), false])];
    case "set-feed": return [call(v, "setFeed", [getAddress(env("TOKEN")), getAddress(env("FEED")), Number(env("HEARTBEAT"))])];
    case "revoke": return [call(v, "revokeApproval", [getAddress(env("TOKEN")), getAddress(env("SPENDER"))])];
    default: throw new Error(`unknown OP ${op}`);
  }
});
const chainId = await pc.getChainId();
const batch = { version: "1.0", chainId: String(chainId), createdAt: Date.now(), meta: { name: `Heimdall ops: ${op}`, description: `${op} on ${sel.length} vault(s)` }, transactions: txs };
mkdirSync("deployments/ops", { recursive: true });
const file = `deployments/ops/${networkName}-${op}-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(batch, null, 2));
console.log(`${txs.length} transaction(s) for ${sel.length} vault(s) → ${file}`);
