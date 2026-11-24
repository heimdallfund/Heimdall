/**
 * One pass of every monitor and keeper job. The long-running container (index.ts) calls it in a loop; the Vercel
 * cron (api/cron.ts) calls it once per invocation. Everything that must survive between passes lives in `State`,
 * so a serverless run neither re-sends alerts nor repeats a daily job.
 */
import { createPublicClient, createWalletClient, defineChain, fallback, getAddress, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { collect } from "./collect.js";
import { DEFAULTS, PAUSE_DEFAULTS, diff, evaluate, format, toPause } from "./rules.js";
import { webhook } from "./notify.js";
import { arenaRows, corporateActions, heartbeat, type HeartbeatAuth, watchAll, depositSnapshot, distributeFees, formatCorporateAction, postArena, postSnapshot, publishPassports, riskSync, runAutoInvest, sweepAutoInvestFees } from "./jobs.js";

export type Env = Record<string, string | undefined>;

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

export type State = {
  active: string[];
  lastBlock: string | null;
  lastDaily: string;
  lastArenaHour: string;
  seenActions: string[];
  lastWatch: number;
  lastRisk: number;
  lastPassportDay: string;
};

export const emptyState = (env: Env): State => ({
  active: [], lastBlock: env.FROM_BLOCK ?? null, lastDaily: "", lastArenaHour: "", seenActions: [], lastWatch: 0, lastRisk: 0, lastPassportDay: "",
});

const PAUSE_ABI = [{ type: "function", name: "pause", inputs: [], outputs: [], stateMutability: "nonpayable" }] as const;

export function rpcFor(env: Env) {
  /** RPC_URL, then RPC_URL_BACKUP, then the public endpoint: a provider outage does not stop the monitor or the keeper. */
  const urls = [env.RPC_URL, env.RPC_URL_BACKUP, robinhoodChain.rpcUrls.default.http[0]].filter((u, i, a): u is string => !!u && a.indexOf(u) === i);
  return () => (urls.length > 1 ? fallback(urls.map((u, i) => http(u, { timeout: 8_000, retryCount: i === urls.length - 1 ? 1 : 0 })), { retryCount: 0 }) : http(urls[0]));
}

/** Runs every job once. Jobs with their own cadence (daily, hourly, every N minutes) check `state` and skip when not due. */
export async function runOnce(env: Env, state: State, log: (s: string) => void = console.log) {
  const rpc = rpcFor(env);
  const client = createPublicClient({ chain: robinhoodChain, transport: rpc() });
  const send = webhook(env.ALERT_WEBHOOK_URL);
  const shield = env.SHIELD_API_URL, admin = env.SHIELD_ADMIN_KEY;
  // The status heartbeat prefers SHIELD_HEARTBEAT_KEY, which can do nothing but report status.
  const hbAuth: HeartbeatAuth | null = env.SHIELD_HEARTBEAT_KEY ? { heartbeatKey: env.SHIELD_HEARTBEAT_KEY } : admin ?? null;
  const errors: string[] = [];
  const wallet = (key: string) => createWalletClient({ chain: robinhoodChain, transport: rpc(), account: privateKeyToAccount(key as `0x${string}`) });
  const factory: Address | null = env.FACTORY ? getAddress(env.FACTORY) : null;
  const holders = new Map<string, number>();
  const fromBlock = BigInt(env.DEPLOY_BLOCK ?? env.FROM_BLOCK ?? 0);
  const step = async (name: string, fn: () => Promise<void>, alert = false) => {
    try { await fn(); } catch (e) {
      const msg = (e as Error).message.split("\n")[0]!;
      errors.push(`${name}: ${msg}`);
      if (alert) await send(`🟠 ${name} failed\n${msg}`).catch(() => {}); else log(`${name} failed: ${msg}`);
    }
  };

  // vault alerts (needs the factory, i.e. after launch)
  if (factory) await step("Vault check", async () => {
    const thresholds = {
      tradeLossBps: Number(env.TRADE_LOSS_ALERT_BPS ?? DEFAULTS.tradeLossBps),
      dailyBudgetUsedPct: Number(env.DAILY_BUDGET_ALERT_PCT ?? DEFAULTS.dailyBudgetUsedPct),
      capUsedPct: Number(env.CAP_ALERT_PCT ?? DEFAULTS.capUsedPct),
    };
    const { snapshot, toBlock } = await collect(client, factory, shield, state.lastBlock ? BigInt(state.lastBlock) : null);
    state.lastBlock = toBlock === null || toBlock === undefined ? state.lastBlock : String(toBlock);
    // the guardian key may only pause: it stops a vault whose losses look like theft, the Safe reviews and unpauses
    if (env.GUARDIAN_KEY) {
      const rules = { tradeLossBps: Number(env.PAUSE_TRADE_LOSS_BPS ?? PAUSE_DEFAULTS.tradeLossBps), budgetUsedPct: Number(env.PAUSE_BUDGET_PCT ?? PAUSE_DEFAULTS.budgetUsedPct) };
      for (const p of toPause(snapshot, rules)) {
        try {
          const w = wallet(env.GUARDIAN_KEY);
          const hash = await w.writeContract({ address: getAddress(p.address), abi: PAUSE_ABI, functionName: "pause", chain: robinhoodChain, account: w.account! });
          await client.waitForTransactionReceipt({ hash });
          for (const v of snapshot.vaults) if (v.address === p.address) v.paused = true;
          await send(`🛑 Vault paused by the guardian: ${p.address}\nReason: ${p.reason}. Trading and deposits are stopped; withdrawals keep working. Review the manager, then unpause from the Safe (OP=unpause) or replace the manager.`);
        } catch (e) {
          await send(`🔴 Guardian could not pause ${p.address}\n${(e as Error).message.split("\n")[0]}`);
        }
      }
    }
    const d = diff(new Set(state.active), evaluate(snapshot, thresholds));
    state.active = [...d.active];
    for (const a of d.fire) await send(format(a));
    for (const k of d.resolved) await send(`✅ Resolved\n${k.replace(/^0x[0-9a-fA-F]{40}:/, "vault ")}`);
    log(`${new Date().toISOString()} · ${snapshot.vaults.length} vault(s) · ${d.fire.length} alert(s) · ${d.active.size} active`);
  });

  // once per UTC day: points snapshot, Auto-Invest fee sweep, fee distribution
  const day = new Date().toISOString().slice(0, 10);
  if (day !== state.lastDaily) {
    state.lastDaily = day;
    if (factory && shield && admin) await step("Points snapshot", async () => {
      const holdings = await depositSnapshot(client, factory, fromBlock, undefined, holders);
      const r = await postSnapshot(shield, admin, day, holdings);
      log(`points snapshot ${day}: ${Object.keys(holdings).length} holder(s), ${r.awarded} point(s)`);
    }, true);
    if (env.SPLITTER && env.KEEPER_KEY && env.USDG) await step("Fee distribution", async () => {
      const w = wallet(env.KEEPER_KEY!);
      if (env.AUTOINVEST) await sweepAutoInvestFees(w, client as never, getAddress(env.AUTOINVEST)).catch((e) => send(`🟠 Auto-Invest fee sweep failed\n${(e as Error).message}`));
      const r = await distributeFees(w, client as never, getAddress(env.SPLITTER!), getAddress(env.USDG!));
      if (r) await send(`🔵 Fees distributed\n${Number(r.amount) / 1e6} USDG split between $HEIM stakers and the treasury (${r.hash})`);
    }, true);
  }

  // every pass: due Auto-Invest buys, then the heartbeats the status page reads
  if (env.AUTOINVEST && env.KEEPER_KEY) await step("Keeper", async () => {
    const r = await runAutoInvest(wallet(env.KEEPER_KEY!), client as never, getAddress(env.AUTOINVEST!));
    if (r.done.length) log(`auto-invest: executed ${r.done.length} buy(s)`);
    for (const s of r.skipped) if (!/NotDue|Inactive/.test(s.reason)) log(`auto-invest: plan ${s.id} skipped: ${s.reason}`);
    if (shield && hbAuth) await heartbeat(shield, hbAuth, "keeper", null);
  });
  if (shield && hbAuth) await heartbeat(shield, hbAuth, "monitor", client as never).catch(() => {});

  // hourly: corporate actions on stock tokens, then the Agent Arena snapshot
  const hour = new Date().toISOString().slice(0, 13);
  if (hour !== state.lastArenaHour) {
    state.lastArenaHour = hour;
    await step("Corporate actions", async () => {
      const seen = new Set(state.seenActions), now = new Set<string>();
      for (const a of await corporateActions(client as never)) {
        const key = `${a.symbol}:${a.paused}:${a.next?.at ?? 0}`;
        now.add(key);
        if (!seen.has(key)) await send(formatCorporateAction(a));
      }
      for (const k of seen) if (!now.has(k) && k.includes(":true:")) await send(`✅ ${k.split(":")[0]}: oracle unpaused`);
      state.seenActions = [...now];
    });
    if (factory && shield && admin) await step("Arena snapshot", async () => { await postArena(shield, admin, await arenaRows(client, factory, holders)); });
  }

  // every WATCH_EVERY_MIN minutes (15): Wallet Watch
  if (shield && admin && Date.now() - state.lastWatch >= Number(env.WATCH_EVERY_MIN ?? 15) * 60_000) {
    state.lastWatch = Date.now();
    await step("Wallet watch", async () => {
      const r = await watchAll(shield, admin);
      if (r?.notified) log(`wallet watch: ${r.notified} notification(s) over ${r.scanned} wallet(s)`);
    });
  }

  // once a day: Heimdall Scores to the ERC-8004 Reputation Registry
  if (env.PASSPORT_KEY && shield && admin && day !== state.lastPassportDay) {
    state.lastPassportDay = day;
    await step("Passport publishing", async () => {
      const r = await publishPassports(wallet(env.PASSPORT_KEY!), client as never, shield, admin);
      if (r.published.length) await send(`🪪 Heimdall Scores published\n${r.published.length} agent(s) updated on the ERC-8004 Reputation Registry`);
    }, true);
  }

  // every RISK_EVERY_MIN minutes (10): Shield's risk list to the onchain Risk Oracle
  if (env.RISK_ORACLE && env.RISK_REPORTER_KEY && shield && Date.now() - state.lastRisk >= Number(env.RISK_EVERY_MIN ?? 10) * 60_000) {
    state.lastRisk = Date.now();
    await step("Risk Oracle sync", async () => {
      const r = await riskSync(wallet(env.RISK_REPORTER_KEY!), client as never, getAddress(env.RISK_ORACLE!), shield, fromBlock);
      if (r.changed) await send(`🛡 Risk Oracle updated\n${r.changed} address(es) written onchain (${r.listed} on Shield's list)`);
    }, true);
  }

  return { errors, launched: !!factory };
}
