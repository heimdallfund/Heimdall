import { createPublicClient, http, encodeFunctionData, parseAbi, toHex, maxUint256, pad, type PublicClient } from "viem";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deepTests, BUYER } from "../src/powers.js";
const art = (n: string) => JSON.parse(readFileSync(new URL(`../../../contracts/artifacts/contracts/mocks/ScamTokenMock.sol/${n}.json`, import.meta.url), "utf8")).deployedBytecode;
const TOKEN = "0x00000000000000000000000000000000000000cc", POOL = "0x00000000000000000000000000000000000000bb", OWNER = "0x00000000000000000000000000000000000000AA";
const base = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com", { timeout: 20000 }) });
function wrap(extra: Record<string, any>): PublicClient {
  const ov: Record<string, any> = { [TOKEN]: { code: art("ScamTokenMock"), ...(extra.token ?? {}) }, [POOL]: { code: art("ScamPoolMock"), balance: toHex(10n ** 20n) } };
  return { ...base, getBlock: base.getBlock, getCode: async ({ address }: any) => (ov[address.toLowerCase()]?.code ?? base.getCode({ address })),
    getStorageAt: async () => "0x" + "0".repeat(64),
    readContract: (a: any) => base.readContract({ ...a, stateOverride: Object.entries(ov).map(([address, v]: any) => ({ address, code: v.code, ...(v.stateDiff ? { stateDiff: v.stateDiff } : {}) })) }),
    request: async (req: any) => {
      if (req.method === "eth_simulateV1") { const b0 = req.params[0].blockStateCalls[0]; b0.stateOverrides = { ...(b0.stateOverrides ?? {}), ...ov }; }
      return base.request(req);
    } } as any;
}
const P = parseAbi(["function buy() payable", "function sell(uint256)", "function approve(address,uint256) returns (bool)"]);
const route = { label: "mock", sink: POOL as `0x${string}`, bigWei: 10n ** 17n,
  buy: (wei: bigint) => [{ from: BUYER, to: POOL as any, data: encodeFunctionData({ abi: P, functionName: "buy" }), value: wei }],
  sell: (amt: bigint) => [{ from: BUYER, to: TOKEN as any, data: encodeFunctionData({ abi: P, functionName: "approve", args: [POOL as any, maxUint256] }) }, { from: BUYER, to: POOL as any, data: encodeFunctionData({ abi: P, functionName: "sell", args: [amt] }) }] };

/** Runs against mainnet state with the mock token placed by state overrides. Opt-in: LIVE=1 npx vitest run test/powers.live.test.ts */
describe.skipIf(!process.env.LIVE)("owner powers, live", () => {
  it("finds every power of the scam mock and its time bomb", async () => {
    const now = Number((await base.getBlock()).timestamp);
    const plain = wrap({});
    const r = await deepTests(plain, TOKEN as any, (await plain.getCode({ address: TOKEN as any })) as any, OWNER as any, route);
    expect(r.powers).toMatchObject({ mint: true, blacklist: true, pause: true, sellLater: true, ownerTested: true });
    expect(r.powers.maxSellTaxPct).toBeGreaterThanOrEqual(90);
    const bomb = wrap({ token: { stateDiff: { [pad("0x6")]: pad(toHex(now + 3 * 86400)) } } });
    const b = await deepTests(bomb, TOKEN as any, (await bomb.getCode({ address: TOKEN as any })) as any, OWNER as any, route);
    expect(b.findings.find((f) => f.code === "SELL_BLOCKED_LATER")?.severity).toBe("deny");
  }, 120_000);
});
