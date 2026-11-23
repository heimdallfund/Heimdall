import { createPublicClient, http, type PublicClient } from "viem";
import { robinhoodChain } from "@heimdall/sdk";
import { buildApp, configFromEnv } from "/home/claude/heimdall/apps/signals/src/server.ts";
const cfg = { ...configFromEnv(), free: true };
const app = buildApp(cfg, createPublicClient({ chain: robinhoodChain, transport: http() }) as PublicClient);
for (const p of ["/v1/token-risk?token=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", "/v1/token-risk?token=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", "/v1/address-intel?address=0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]) {
  const r = await app.request(p); console.log(p.split("?")[0], JSON.stringify(await r.json()).slice(0, 330));
}
