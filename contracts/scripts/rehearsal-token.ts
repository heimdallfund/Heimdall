/** Rehearsal only: a stand-in $HEIM (1,000,000,000 minted to the deployer) on a local fork. */
import { writeFileSync } from "node:fs";
import { network } from "hardhat";
const { viem, networkName } = await network.connect();
if (networkName !== "localhost") throw new Error("rehearsal token is for a local fork only");
const [me] = await viem.getWalletClients();
const heim = await viem.deployContract("MockERC20", ["Heimdall", "HEIM", 18]);
await heim.write.mint([me.account.address, 1_000_000_000n * 10n ** 18n]);
writeFileSync(`deployments/${networkName}.heim.json`, JSON.stringify({ HEIM: heim.address }, null, 2));
console.log(`HEIM ${heim.address}`);
