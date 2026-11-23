// Regenerates the ABI files used by the SDK and the web app: node scripts/gen-abi.mjs
import { readFileSync, writeFileSync } from "node:fs";
const art = (n) => JSON.parse(readFileSync(new URL(`../artifacts/contracts/${n}.sol/${n}.json`, import.meta.url))).abi;
const out = ["// Generated from contracts/artifacts — do not edit by hand."];
for (const [name, c] of [["heimdallVaultAbi", "HeimdallVault"], ["heimdallVaultFactoryAbi", "HeimdallVaultFactory"], ["heimdallSignalsAbi", "HeimdallSignals"], ["heimdallStakingAbi", "HeimdallStaking"], ["heimdallFeeSplitterAbi", "HeimdallFeeSplitter"], ["heimdallPayAbi", "HeimdallPay"], ["heimdallAutoInvestAbi", "HeimdallAutoInvest"], ["heimdallRiskOracleAbi", "HeimdallRiskOracle"], ["heimdallGuardModuleAbi", "HeimdallGuardModule"]]) {
  out.push(`export const ${name} = ${JSON.stringify(art(c))} as const;`, "");
}
for (const f of ["../../packages/sdk/src/abi.ts", "../../apps/web/src/lib/abi.ts"]) writeFileSync(new URL(f, import.meta.url), out.join("\n"));
console.log("abi written");
