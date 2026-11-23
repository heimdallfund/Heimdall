import { createPublicClient, fallback, getAddress, http } from "viem";
import { robinhoodChain } from "@heimdall/sdk";
import { collect } from "./collect.js";
import { DEFAULTS, diff, evaluate, format } from "./rules.js";
import { webhook } from "./notify.js";
import { arenaRows, corporateActions, heartbeat, watchAll, depositSnapshot, distributeFees, formatCorporateAction, postArena, postSnapshot, runAutoInvest, sweepAutoInvestFees } from "./jobs.js";
import { createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = process.env;
if (!env.FACTORY) throw new Error("set FACTORY (HeimdallVaultFactory address)");
const factory = getAddress(env.FACTORY);
/** RPC_URL, then RPC_URL_BACKUP, then the public endpoint: a provider outage does not stop the monitor or the keeper. */
const rpcUrls = [env.RPC_URL, env.RPC_URL_BACKUP, robinhoodChain.rpcUrls.default.http[0]].filter((u, i, a): u is string => !!u && a.indexOf(u) === i);
const rpc = () => rpcUrls.length > 1 ? fallback(rpcUrls.map((u, i) => http(u, { timeout: 8_000, retryCount: i === rpcUrls.length - 1 ? 1 : 0 })), { retryCount: 0 }) : http(rpcUrls[0]);
const client = createPublicClient({ chain: robinhoodChain, transport: rpc() });
const send = webhook(env.ALERT_WEBHOOK_URL);
const thresholds = {
  tradeLossBps: Number(env.TRADE_LOSS_ALERT_BPS ?? DEFAULTS.tradeLossBps),
  dailyBudgetUsedPct: Number(env.DAILY_BUDGET_ALERT_PCT ?? DEFAULTS.dailyBudgetUsedPct),
  capUsedPct: Number(env.CAP_ALERT_PCT ?? DEFAULTS.capUsedPct),
};
const intervalMs = Number(env.INTERVAL_SEC ?? 120) * 1000;

let active = new Set<string>();
let lastBlock: bigint | null = env.FROM_BLOCK ? BigInt(env.FROM_BLOCK) : null;

async function tick() {
  const { snapshot, toBlock } = await collect(client, factory, env.SHIELD_API_URL, lastBlock);
  lastBlock = toBlock;
  const d = diff(active, evaluate(snapshot, thresholds));
  active = d.active;
  for (const a of d.fire) await send(format(a));
  for (const k of d.resolved) await send(`✅ Resolved\n${k.replace(/^0x[0-9a-fA-F]{40}:/, "vault ")}`);
  console.log(`${new Date().toISOString()} · ${snapshot.vaults.length} vault(s) · ${d.fire.length} alert(s) · ${active.size} active`);
}

let lastDaily = "";
const holders = new Map<string, number>();
let lastArenaHour = "";
const seenActions = new Set<string>();
/** Hourly: alert once per stock token when its oracle is paused or a multiplier change is scheduled. */
async function watchCorporateActions() {
  const now = new Set<string>();
  for (const a of await corporateActions(client as never)) {
    const key = `${a.symbol}:${a.paused}:${a.next?.at ?? 0}`;
    now.add(key);
    if (!seenActions.has(key)) await send(formatCorporateAction(a));
  }
  for (const k of seenActions) if (!now.has(k)) { seenActions.delete(k); if (k.includes(":true:")) await send(`✅ ${k.split(":")[0]}: oracle unpaused`); }
  for (const k of now) seenActions.add(k);
}
/** Hourly: corporate-action watch on stock tokens, then the Agent Arena snapshot of every vault (share price, TVL). */
async function arena() {
  const hour = new Date().toISOString().slice(0, 13);
  if (hour === lastArenaHour) return;
  lastArenaHour = hour;
  await watchCorporateActions().catch((e) => console.log(`corporate actions: ${(e as Error).message}`));
  if (!env.SHIELD_API_URL || !env.SHIELD_ADMIN_KEY) return;
  const rows = await arenaRows(client, factory, holders);
  await postArena(env.SHIELD_API_URL, env.SHIELD_ADMIN_KEY, rows);
}
/** Every WATCH_EVERY_MIN minutes (15): Wallet Watch passes until every watched wallet was re-scanned once. */
let lastWatch = 0;
async function walletWatch() {
  if (!env.SHIELD_API_URL || !env.SHIELD_ADMIN_KEY) return;
  if (Date.now() - lastWatch < Number(env.WATCH_EVERY_MIN ?? 15) * 60_000) return;
  lastWatch = Date.now();
  const r = await watchAll(env.SHIELD_API_URL, env.SHIELD_ADMIN_KEY);
  if (r?.notified) console.log(`wallet watch: ${r.notified} notification(s) over ${r.scanned} wallet(s)`);
}
/** Once per UTC day: deposit points snapshot (SHIELD_ADMIN_KEY) and fee distribution (SPLITTER + KEEPER_KEY). */
async function daily() {
  const day = new Date().toISOString().slice(0, 10);
  if (day === lastDaily) return;
  lastDaily = day;
  if (env.SHIELD_API_URL && env.SHIELD_ADMIN_KEY) {
    try {
      const holdings = await depositSnapshot(client, factory, BigInt(env.DEPLOY_BLOCK ?? env.FROM_BLOCK ?? 0), undefined, holders);
      const r = await postSnapshot(env.SHIELD_API_URL, env.SHIELD_ADMIN_KEY, day, holdings);
      console.log(`points snapshot ${day}: ${Object.keys(holdings).length} holder(s), ${r.awarded} point(s)`);
    } catch (e) { await send(`🟠 Points snapshot failed\n${(e as Error).message}`); }
  }
  if (env.SPLITTER && env.KEEPER_KEY && env.USDG) {
    try {
      const wallet = createWalletClient({ chain: robinhoodChain, transport: rpc(), account: privateKeyToAccount(env.KEEPER_KEY as `0x${string}`) });
      if (env.AUTOINVEST) await sweepAutoInvestFees(wallet, client as never, getAddress(env.AUTOINVEST)).catch((e) => send(`🟠 Auto-Invest fee sweep failed\n${(e as Error).message}`));
      const r = await distributeFees(wallet, client as never, getAddress(env.SPLITTER), getAddress(env.USDG));
      if (r) await send(`🔵 Fees distributed\n${Number(r.amount) / 1e6} USDG split between $HEIM stakers and the treasury (${r.hash})`);
    } catch (e) { await send(`🟠 Fee distribution failed\n${(e as Error).message}`); }
  }
}

/** Every tick: execute due Auto-Invest buys (AUTOINVEST + KEEPER_KEY). */
async function keeper() {
  if (!env.AUTOINVEST || !env.KEEPER_KEY) return;
  const wallet = createWalletClient({ chain: robinhoodChain, transport: rpc(), account: privateKeyToAccount(env.KEEPER_KEY as `0x${string}`) });
  const r = await runAutoInvest(wallet, client as never, getAddress(env.AUTOINVEST));
  if (r.done.length) console.log(`auto-invest: executed ${r.done.length} buy(s)`);
  for (const s of r.skipped) if (!/NotDue|Inactive/.test(s.reason)) console.log(`auto-invest: plan ${s.id} skipped: ${s.reason}`);
}

if (process.argv.includes("--once")) {
  await tick();
} else {
  await send(`🛡 Heimdall monitor started\nWatching factory ${factory}`);
  for (;;) {
    try { await tick(); } catch (e) { console.error("tick failed", e); }
    try { await daily(); } catch (e) { console.error("daily job failed", e); }
    try {
      await keeper();
      if (env.AUTOINVEST && env.KEEPER_KEY && env.SHIELD_API_URL && env.SHIELD_ADMIN_KEY) await heartbeat(env.SHIELD_API_URL, env.SHIELD_ADMIN_KEY, "keeper", null);
    } catch (e) { console.error("keeper failed", e); }
    if (env.SHIELD_API_URL && env.SHIELD_ADMIN_KEY) await heartbeat(env.SHIELD_API_URL, env.SHIELD_ADMIN_KEY, "monitor", client as never).catch(() => {});
    try { await arena(); } catch (e) { console.error("arena snapshot failed", e); }
    try { await walletWatch(); } catch (e) { console.error("wallet watch failed", e); }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
