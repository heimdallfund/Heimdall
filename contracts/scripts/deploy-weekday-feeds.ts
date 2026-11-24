/**
 * Adds the 24/5 Robinhood Stock Tokens in deploy/<network>.weekday-assets.json to Heimdall:
 *   1. per stock, deploys HeimdallStockFeed (Chainlink feed priced in USDG) wrapped in HeimdallWeekdayFeed
 *      (closed Sat 00:00 to Mon 01:00 UTC). Resumable: stocks already in deployments/<network>.json are skipped.
 *   2. writes deployments/<network>.safe-add-stocks.json, the Safe batch that makes them tradable:
 *      factory.setDefaults (current calls and spenders, current assets + the new ones, at most 16) and
 *      AutoInvest.setAsset for each new stock.
 *
 *   npx hardhat run --build-profile production scripts/deploy-weekday-feeds.ts --network robinhood
 */
import { network } from "hardhat";
import { readFileSync, writeFileSync } from "node:fs";
import { encodeFunctionData, getAddress, parseAbi, type Address } from "viem";

const { viem, networkName } = await network.getOrCreate();
const pc = await viem.getPublicClient();
const depPath = `deployments/${networkName}.json`;
const dep = JSON.parse(readFileSync(depPath, "utf8"));
const cfg = JSON.parse(readFileSync(`deploy/${networkName}.config.json`, "utf8"));
const list = JSON.parse(readFileSync(`deploy/${networkName}.weekday-assets.json`, "utf8")) as { heartbeat: number; assets: { symbol: string; token: Address; chainlinkFeed: Address; poolFee: number }[] };
dep.weekdayFeeds ??= {};

for (const a of list.assets) {
  if (dep.weekdayFeeds[a.symbol]?.feed) { console.log(`${a.symbol.padEnd(5)} already deployed ${dep.weekdayFeeds[a.symbol].feed}`); continue; }
  const stock = dep.weekdayFeeds[a.symbol]?.stockFeed
    ? { address: dep.weekdayFeeds[a.symbol].stockFeed as Address }
    : await viem.deployContract("HeimdallStockFeed", [a.chainlinkFeed, a.token, cfg.usdgUsdFeed, cfg.usdgFeedMaxAge, `${a.symbol} / USDG`]);
  dep.weekdayFeeds[a.symbol] = { token: getAddress(a.token), chainlinkFeed: getAddress(a.chainlinkFeed), poolFee: a.poolFee, stockFeed: stock.address };
  writeFileSync(depPath, JSON.stringify(dep, null, 2));
  const wk = await viem.deployContract("HeimdallWeekdayFeed", [stock.address, `${a.symbol} / USDG (weekdays)`]);
  dep.weekdayFeeds[a.symbol].feed = wk.address;
  writeFileSync(depPath, JSON.stringify(dep, null, 2));
  const r = await wk.read.latestRoundData();
  console.log(`${a.symbol.padEnd(5)} ${wk.address}  price ${(Number(r[1]) / 1e8).toFixed(2)} USDG${r[3] === 0n ? " (market closed now)" : ""}`);
}

const factory = dep.contracts.HeimdallVaultFactory as Address;
const autoInvest = dep.contracts.HeimdallAutoInvest as Address;
const FA = parseAbi(["function getDefaults() view returns ((address target,bytes4 selector)[] calls,address[] spenders,(address token,address feed,uint32 heartbeat)[] assets)", "function setDefaults((address target,bytes4 selector)[] calls,address[] spenders,(address token,address feed,uint32 heartbeat)[] assets)"]);
const [calls, spenders, current] = await pc.readContract({ address: factory, abi: FA, functionName: "getDefaults" });
const have = new Set(current.map((x) => getAddress(x.token)));
const added = list.assets.filter((a) => !have.has(getAddress(a.token)));
const assets = [...current, ...added.map((a) => ({ token: getAddress(a.token), feed: dep.weekdayFeeds[a.symbol].feed as Address, heartbeat: list.heartbeat }))];
if (assets.length > 16) throw new Error(`${assets.length} assets: a vault tracks at most 16`);
const AI = parseAbi(["function setAsset(address token,address feed,uint24 poolFee,uint32 maxAge,bool enabled)"]);
const transactions = [
  { to: factory, value: "0", data: encodeFunctionData({ abi: FA, functionName: "setDefaults", args: [calls, spenders, assets] }) },
  ...added.map((a) => ({ to: autoInvest, value: "0", data: encodeFunctionData({ abi: AI, functionName: "setAsset", args: [getAddress(a.token), dep.weekdayFeeds[a.symbol].feed, a.poolFee, list.heartbeat, true] }) })),
];
writeFileSync(`deployments/${networkName}.safe-add-stocks.json`, JSON.stringify({
  version: "1.0", chainId: String(await pc.getChainId()), createdAt: Date.now(),
  meta: { name: "Heimdall: add 24/5 stocks", description: `Vault defaults: ${assets.length} assets (+${added.map((a) => a.symbol).join(", ")}); Auto-Invest: ${added.length} new stocks` },
  transactions,
}, null, 2));
console.log(`\nwrote deployments/${networkName}.safe-add-stocks.json: ${transactions.length} calls, ${assets.length} vault assets`);
