import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { encodeFunctionData, getAddress, keccak256, parseAbi, toHex, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { executeThroughGuard, guardRemaining, guardSetupCalls, HeimdallDenied, HeimdallShield } from "../../../packages/sdk/src/index.ts";

const { viem } = await network.create();
const SHIELD = privateKeyToAccount("0x00000000000000000000000000000000000000000000000000000000000a11ce");
const ERC20 = parseAbi(["function transfer(address,uint256) returns (bool)"]);

/** A stand-in for the Shield API: signs receipts exactly like apps/shield/src/receipt.ts, or denies. */
function fakeShield(chainId: number, deny = false) {
  let n = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const tx = JSON.parse(String(init.body));
    if (deny) return new Response(JSON.stringify({ verdict: "DENY", riskScore: 95, findings: [{ code: "BLOCKLISTED_TARGET", severity: "deny", message: "drainer" }], summary: ["no"], simulation: null }), { status: 200 });
    const expiresAt = Math.floor(Date.now() / 1000) + 120;
    const message = { agent: getAddress(tx.from), target: getAddress(tx.to), dataHash: keccak256(tx.data), value: BigInt(tx.value), verdict: 0, expiresAt: BigInt(expiresAt), checkId: keccak256(toHex(`c${++n}`)) };
    const signature = await SHIELD.signTypedData({
      domain: { name: "Heimdall Shield", version: "1", chainId },
      types: { Receipt: [{ name: "agent", type: "address" }, { name: "target", type: "address" }, { name: "dataHash", type: "bytes32" }, { name: "value", type: "uint256" }, { name: "verdict", type: "uint8" }, { name: "expiresAt", type: "uint64" }, { name: "checkId", type: "bytes32" }] },
      primaryType: "Receipt", message,
    });
    return new Response(JSON.stringify({ verdict: "ALLOW", riskScore: 0, findings: [], summary: ["ok"], simulation: null,
      receipt: { signer: SHIELD.address, signature, expiresAt, message: { ...message, value: message.value.toString(), expiresAt: String(expiresAt) } } }), { status: 200 });
  }) as unknown as typeof fetch;
  return new HeimdallShield({ baseUrl: "http://shield", fetch: fetchImpl });
}

describe("Heimdall Guard via the SDK (real Safe 1.4.1)", () => {
  it("sets up from the Safe, lets the agent spend within limits, and stops a denied call before the chain", async () => {
    const [owner, agent, bob] = await viem.getWalletClients();
    const pc = await viem.getPublicClient();
    const chainId = await pc.getChainId();
    const singleton = await viem.deployContract("TestSafe");
    const factory = await viem.deployContract("TestSafeProxyFactory");
    const setup = encodeFunctionData({ abi: singleton.abi, functionName: "setup", args: [[owner.account.address], 1n, zeroAddress, "0x", zeroAddress, zeroAddress, 0n, zeroAddress] });
    const { result: proxy } = await factory.simulate.createProxyWithNonce([singleton.address, setup, 7n]);
    await factory.write.createProxyWithNonce([singleton.address, setup, 7n]);
    const safe = await viem.getContractAt("TestSafe", proxy);
    const usdg = await viem.deployContract("MockERC20", ["Global Dollar", "USDG", 6]);
    await usdg.write.mint([safe.address, 5_000_000_000n]);
    const module = await viem.deployContract("HeimdallGuardModule", [owner.account.address, SHIELD.address]);

    // the Safe owner executes the setup calls the SDK builds
    const ownerSig = (`0x${owner.account.address.slice(2).padStart(64, "0")}${"0".repeat(64)}01`) as `0x${string}`;
    for (const c of guardSetupCalls(safe.address, { module: module.address, agent: agent.account.address, tokens: [{ token: usdg.address, perDay: 1_000_000_000n }] })) {
      await safe.write.execTransaction([c.to, BigInt(c.value), c.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, ownerSig]);
    }
    assert.equal(await safe.read.isModuleEnabled([module.address]), true);

    const shield = fakeShield(chainId);
    const data = encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [bob.account.address, 600_000_000n] });
    await executeThroughGuard(agent, { module: module.address, safe: safe.address, to: usdg.address, data }, { shield });
    assert.equal(await usdg.read.balanceOf([bob.account.address]), 600_000_000n);
    assert.equal(await guardRemaining(pc as never, module.address, safe.address, usdg.address), 400_000_000n);

    // over the daily limit: the receipt is fine, the module still refuses
    await assert.rejects(executeThroughGuard(agent, { module: module.address, safe: safe.address, to: usdg.address, data }, { shield }), /LimitExceeded/);

    // a DENY from Shield never reaches the chain
    await assert.rejects(executeThroughGuard(agent, { module: module.address, safe: safe.address, to: usdg.address, data }, { shield: fakeShield(chainId, true) }), (e) => e instanceof HeimdallDenied);
  });
});
