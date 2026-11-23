import { encodeFunctionData, maxUint256, parseAbi, parseEther } from "viem";
import { checkTransaction } from "../src/shield.js";
import { clientFor } from "../src/server.js";
const ERC20 = parseAbi(["function approve(address,uint256)", "function transfer(address,uint256)"]);
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const AGENT = "0x1111111111111111111111111111111111111111";
const EOA = "0x3333333333333333333333333333333333333333";
const client = clientFor(4663);
const cases: [string, any][] = [
  ["unlimited approve USDG → EOA", { from: AGENT, to: USDG, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [EOA, maxUint256] }), value: 0n }],
  ["transfer USDG without balance", { from: AGENT, to: USDG, data: encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [EOA, 10n ** 12n] }), value: 0n }],
  ["send 0.001 ETH (from WETH contract) → EOA", { from: WETH, to: EOA, data: "0x", value: parseEther("0.001") }],
  ["wrap ETH via WETH.deposit()", { from: WETH, to: WETH, data: "0xd0e30db0", value: parseEther("0.001") }],
];
for (const [name, t] of cases) {
  const r = await checkTransaction({ chainId: 4663, ...t }, {}, { client, sign: false });
  console.log(`\n# ${name}\n  verdict=${r.verdict} risk=${r.riskScore} sim=${JSON.stringify({ ok: r.simulation.ok, available: r.simulation.available, revert: r.simulation.revertReason })}`);
  r.summary.forEach((s) => console.log("  •", s));
  r.findings.forEach((f) => console.log(`  [${f.severity}] ${f.code}: ${f.message}`));
}
