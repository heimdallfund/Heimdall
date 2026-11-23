/**
 * Redeem the latest accepted voucher of every payer, for each Heimdall signal, onchain.
 * Run on a schedule (e.g. hourly). Env: PROVIDER_KEY (gas payer, any wallet), HEIMDALL_SIGNALS_ADDRESS,
 * SIGNAL_ID_* , UPSTASH_REDIS_REST_URL/TOKEN, RPC_URL_MAINNET.
 */
import { createPublicClient, createWalletClient, fallback, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { heimdallSignalsAbi, robinhoodChain } from "@heimdallfund/sdk";
import { configFromEnv } from "../src/server.js";
import { UpstashLedger } from "../src/ledger.js";

const env = process.env;
const cfg = configFromEnv();
if (!env.PROVIDER_KEY || !env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) throw new Error("PROVIDER_KEY and UPSTASH_* required");
const transport = fallback([...(env.RPC_URL_MAINNET ? [http(env.RPC_URL_MAINNET)] : []), http()]);
const pub = createPublicClient({ chain: robinhoodChain, transport });
const wallet = createWalletClient({ chain: robinhoodChain, transport, account: privateKeyToAccount(env.PROVIDER_KEY as Hex) });
const ledger = new UpstashLedger(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);

for (const id of Object.values(cfg.ids).filter((x): x is bigint => x !== undefined)) {
  for (const v of await ledger.pending(id)) {
    const claimed = await pub.readContract({ address: cfg.signals, abi: heimdallSignalsAbi, functionName: "claimed", args: [v.voucher.payer, id] });
    if (v.voucher.cumulativeAmount <= claimed) continue;
    try {
      const hash = await wallet.writeContract({ address: cfg.signals as Address, abi: heimdallSignalsAbi, functionName: "redeem", args: [v.voucher, v.signature] });
      console.log(`signal ${id} · ${v.voucher.payer} · +${v.voucher.cumulativeAmount - claimed} · ${hash}`);
    } catch (e) {
      console.error(`signal ${id} · ${v.voucher.payer} · failed: ${(e as Error).message.split("\n")[0]}`);
    }
  }
}
