import { parseAbi, parseAbiItem, type Address, type PublicClient } from "viem";
import { heimdallVaultAbi, heimdallVaultFactoryAbi } from "@heimdallfund/sdk";
import type { Snapshot, VaultSnapshot } from "./rules.js";

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)"]);
const EXECUTED = parseAbiItem("event Executed(address indexed target, bytes4 indexed selector, bytes32 indexed checkId, uint256 navBefore, uint256 navAfter)");

export async function collect(client: PublicClient, factory: Address, shieldUrl: string | undefined, fromBlock: bigint | null): Promise<{ snapshot: Snapshot; toBlock: bigint }> {
  const toBlock = await client.getBlockNumber();
  const count = Number(await client.readContract({ address: factory, abi: heimdallVaultFactoryAbi, functionName: "vaultCount" }));
  const addrs = await Promise.all(Array.from({ length: count }, (_, i) => client.readContract({ address: factory, abi: heimdallVaultFactoryAbi, functionName: "allVaults", args: [BigInt(i)] })));
  const r = <T,>(address: Address, functionName: string, args: unknown[] = []) => client.readContract({ address, abi: heimdallVaultAbi, functionName: functionName as never, args: args as never }) as Promise<T>;

  const vaults: VaultSnapshot[] = await Promise.all(addrs.map(async (address) => {
    const [name, paused, depositCap, maxDailyLossBps, lossWindowStart, lossWindowNav, lossWindowLoss, tracked] = await Promise.all([
      r<string>(address, "name"), r<boolean>(address, "paused"), r<bigint>(address, "depositCap"), r<number>(address, "maxDailyLossBps"),
      r<bigint>(address, "lossWindowStart"), r<bigint>(address, "lossWindowNav"), r<bigint>(address, "lossWindowLoss"), r<Address[]>(address, "trackedAssets"),
    ]);
    const nav = await r<bigint>(address, "totalAssets").catch(() => null);
    const staleAssets: string[] = [];
    for (const t of tracked) {
      const bal = await client.readContract({ address: t, abi: ERC20, functionName: "balanceOf", args: [address] });
      if (bal === 0n) continue;
      const ok = await r<bigint>(address, "valueOf", [t, bal]).then(() => true, () => false);
      if (!ok) staleAssets.push(await client.readContract({ address: t, abi: ERC20, functionName: "symbol" }).catch(() => t));
    }
    const logs = fromBlock === null ? [] : await client.getLogs({ address, event: EXECUTED, fromBlock: fromBlock + 1n, toBlock });
    return {
      address, name, paused, nav, staleAssets, depositCap, maxDailyLossBps: Number(maxDailyLossBps),
      lossWindowStart: Number(lossWindowStart), lossWindowNav, lossWindowLoss,
      execs: logs.map((l) => ({ tx: l.transactionHash ?? "0x", navBefore: l.args.navBefore ?? 0n, navAfter: l.args.navAfter ?? 0n })),
    };
  }));

  let shieldOk: boolean | null = null;
  if (shieldUrl) {
    shieldOk = await fetch(`${shieldUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(8000) }).then((x) => x.ok, () => false);
  }
  return { snapshot: { now: Math.floor(Date.now() / 1000), shieldOk, vaults }, toBlock };
}
