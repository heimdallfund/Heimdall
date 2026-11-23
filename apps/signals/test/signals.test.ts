import { describe, expect, it } from "vitest";
import { createWalletClient, http, type Address, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeVoucherHeader, MemoryLedger, robinhoodChain, signVoucher } from "@heimdall/sdk";
import { buildApp, type SignalsConfig } from "../src/server.js";
import { tokenRisk } from "../src/analyzers.js";

const SIGNALS: Address = "0x00000000000000000000000000000000000000aa";
const TOKEN: Address = "0x4444444444444444444444444444444444444444";
const OWNER: Address = "0x7777777777777777777777777777777777777777";
const IMPL: Address = "0x8888888888888888888888888888888888888888";
const agent = createWalletClient({ account: privateKeyToAccount(generatePrivateKey()), chain: robinhoodChain, transport: http("http://127.0.0.1:1") });

function mockClient(o: { balance?: bigint; proxy?: boolean; mint?: boolean; renounced?: boolean } = {}): PublicClient {
  return {
    getCode: async ({ address }: { address: Address }) => (address === TOKEN ? `0x6080${o.mint ? "6340c10f19" : ""}6000` : address === IMPL ? "0x60806340c10f19" : undefined),
    getStorageAt: async ({ slot }: { slot: string }) => (o.proxy && slot.startsWith("0x3608") ? `0x000000000000000000000000${IMPL.slice(2)}` : "0x" + "00".repeat(32)),
    getTransactionCount: async () => 0,
    getBalance: async () => 0n,
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "balanceOf" || functionName === "available") return o.balance ?? 1_000_000n;
      if (functionName === "claimed") return 0n;
      if (functionName === "symbol") return "MEME";
      if (functionName === "decimals") return 18;
      if (functionName === "totalSupply") return 10n ** 24n;
      if (functionName === "owner") return o.renounced ? "0x0000000000000000000000000000000000000000" : OWNER;
      throw new Error("unexpected " + functionName);
    },
  } as unknown as PublicClient;
}

const cfg: SignalsConfig = {
  chainId: 4663, signals: SIGNALS, usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  ids: { tokenRisk: 0n, addressIntel: 1n }, prices: { tokenRisk: 20_000n, addressIntel: 10_000n, stockPremium: 50_000n },
  stocks: {}, blocklist: new Set(),
};

async function voucherHeader(cumulative: bigint, signalId = 0n) {
  return encodeVoucherHeader(await signVoucher(agent, { chainId: 4663, signals: SIGNALS, signalId, cumulativeAmount: cumulative }));
}

describe("Paid signal endpoints", () => {
  it("answers 402 with payment instructions when no voucher is sent", async () => {
    const app = buildApp(cfg, mockClient());
    const res = await app.request(`/v1/token-risk?token=${TOKEN}`);
    expect(res.status).toBe(402);
    const body = await res.json() as { payment: { pricePerCall: string; signalId: string } };
    expect(body.payment).toMatchObject({ pricePerCall: "20000", signalId: "0" });
  });

  it("serves the signal for a valid voucher and refuses to reuse it", async () => {
    const app = buildApp(cfg, mockClient(), new MemoryLedger());
    const h1 = await voucherHeader(20_000n);
    const ok = await app.request(`/v1/token-risk?token=${TOKEN}`, { headers: { "x-heimdall-voucher": h1 } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-heimdall-paid")).toBe("20000");
    const replay = await app.request(`/v1/token-risk?token=${TOKEN}`, { headers: { "x-heimdall-voucher": h1 } });
    expect(replay.status).toBe(402);
    const h2 = await voucherHeader(40_000n);
    expect((await app.request(`/v1/token-risk?token=${TOKEN}`, { headers: { "x-heimdall-voucher": h2 } })).status).toBe(200);
  });

  it("refuses vouchers the payer's prefunded balance cannot cover", async () => {
    const app = buildApp(cfg, mockClient({ balance: 5_000n }));
    const res = await app.request(`/v1/token-risk?token=${TOKEN}`, { headers: { "x-heimdall-voucher": await voucherHeader(20_000n) } });
    expect(res.status).toBe(402);
  });

  it("lists the catalogue", async () => {
    const list = await (await buildApp(cfg, mockClient()).request("/v1/signals")).json() as { slug: string }[];
    expect(list.map((s) => s.slug)).toEqual(["token-risk", "address-intel", "stock-premium"]);
  });
});

describe("Token risk analyzer", () => {
  it("flags an upgradeable token whose owner can mint", async () => {
    const r = await tokenRisk(mockClient({ proxy: true, mint: true }), TOKEN, new Set());
    expect(r.upgradeable).toBe(true);
    expect(r.ownerPowers).toContain("mint(address,uint256)");
    expect(r.level === "high" || r.level === "medium").toBe(true);
  });

  it("rates a renounced plain token low and a non-contract critical", async () => {
    expect((await tokenRisk(mockClient({ renounced: true }), TOKEN, new Set())).level).toBe("low");
    expect((await tokenRisk(mockClient(), "0x9999999999999999999999999999999999999999", new Set())).level).toBe("critical");
  });
});
