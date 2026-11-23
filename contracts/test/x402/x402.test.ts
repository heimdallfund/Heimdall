import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { getAddress, keccak256, toHex, type Address } from "viem";
import { decodeHeader, encodeHeader, normalizePayload, paymentRequired, requirementsFor, settlePayment, verifyPayment, type PaymentPayload, type X402Network } from "../../../apps/shield/src/x402.ts";
import { MemoryStore } from "../../../apps/shield/src/store.ts";
import { payX402 } from "../../../packages/sdk/src/x402.ts";

const { viem, networkHelpers } = await network.create();

async function setup() {
  const [facilitator, payer, merchant, drainer] = await viem.getWalletClients();
  const pc = await viem.getPublicClient();
  const usdg = await viem.deployContract("MockEIP3009");
  await usdg.write.mint([payer.account.address, 10_000_000n]);
  const net: X402Network = { chainId: await pc.getChainId(), network: `eip155:${await pc.getChainId()}`, legacyNetwork: "hardhat", asset: usdg.address, name: "Global Dollar", version: "1" };
  const req = requirementsFor(net, 1000n, merchant.account.address);
  const now = BigInt(await networkHelpers.time.latest());
  const sign = async (o: { to?: Address; value?: bigint; validBefore?: bigint; nonce?: `0x${string}`; signer?: typeof payer } = {}): Promise<PaymentPayload> => {
    const w = o.signer ?? payer;
    const authorization = { from: w.account.address, to: o.to ?? merchant.account.address, value: o.value ?? 1000n, validAfter: 0n, validBefore: o.validBefore ?? now + 600n, nonce: o.nonce ?? keccak256(toHex(String(Math.random()))) };
    const signature = await w.signTypedData({
      account: w.account,
      domain: { name: "Global Dollar", version: "1", chainId: net.chainId, verifyingContract: usdg.address },
      types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
      primaryType: "TransferWithAuthorization",
      message: authorization,
    });
    const auth = { from: authorization.from, to: authorization.to, value: String(authorization.value), validAfter: "0", validBefore: String(authorization.validBefore), nonce: authorization.nonce };
    return { x402Version: 2, resource: { url: "https://api.example.com/x" }, accepted: { ...req, payTo: getAddress(auth.to), amount: auth.value }, payload: { signature, authorization: auth } };
  };
  return { facilitator, payer, merchant, drainer, pc, usdg, net, req, now, sign };
}

describe("x402 facilitator (USDG, EIP-3009, against a real token contract)", () => {
  it("verifies and settles a valid payment, once", async () => {
    const { facilitator, pc, usdg, net, req, sign, merchant } = await setup();
    const p = await sign();
    const nowSec = Number(await networkHelpers.time.latest());
    assert.deepEqual(await verifyPayment(pc as never, p, req, { net, nowSec }), { isValid: true, payer: getAddress(p.payload.authorization.from) });
    const store = new MemoryStore();
    const r = await settlePayment(facilitator as never, pc as never, p, req, { net, nowSec, store });
    assert.equal(r.success, true);
    assert.equal(await usdg.read.balanceOf([merchant.account.address]), 1000n);
    // replaying the same payment returns the first settlement and moves nothing
    const again = await settlePayment(facilitator as never, pc as never, p, req, { net, nowSec, store });
    assert.equal(again.transaction, r.transaction);
    assert.equal(await usdg.read.balanceOf([merchant.account.address]), 1000n);
    // without the idempotency record the chain itself refuses the used nonce, before any gas is spent
    const v = await verifyPayment(pc as never, p, req, { net, nowSec });
    assert.equal(v.invalidReason, "invalid_exact_evm_payload_authorization_nonce_used");
  });

  it("refuses wrong amount, recipient, expiry, signer, balance and network", async () => {
    const { pc, net, req, sign, drainer, now, merchant } = await setup();
    const nowSec = Number(await networkHelpers.time.latest());
    const v = (p: PaymentPayload, r = req, o = {}) => verifyPayment(pc as never, p, r, { net, nowSec, ...o }).then((x) => x.invalidReason);
    assert.equal(await v(await sign({ value: 999n })), "invalid_exact_evm_payload_authorization_value");
    assert.equal(await v(await sign({ to: drainer.account.address })), "invalid_exact_evm_payload_recipient_mismatch");
    assert.equal(await v(await sign({ validBefore: now + 2n })), "invalid_exact_evm_payload_authorization_valid_before");
    const forged = await sign();
    forged.payload.authorization.from = getAddress(drainer.account.address); // signature is the payer's
    assert.equal(await v(forged), "invalid_exact_evm_payload_signature");
    assert.equal(await v(await sign({ signer: drainer, value: 1000n })), "insufficient_funds");
    assert.equal(await v(await sign(), { ...req, network: "eip155:1" }), "invalid_network");
    assert.equal(await v(await sign(), req, { minAmount: 5000n }), "invalid_exact_evm_payload_authorization_value");
    // Heimdall's own check: a recipient on the risk list is never paid
    assert.equal(await v(await sign(), req, { recipientBlocked: (a: string) => a === getAddress(merchant.account.address) }), "heimdall_recipient_blocked");
  });

  it("accepts v1 bodies and round-trips headers", async () => {
    const { pc, net, req, sign } = await setup();
    const p = await sign();
    const v1 = normalizePayload({ x402Version: 1, scheme: "exact", network: "hardhat", payload: p.payload }, req, net)!;
    assert.equal(v1.accepted.network, net.network);
    assert.equal((await verifyPayment(pc as never, v1, req, { net, nowSec: Number(await networkHelpers.time.latest()) })).isValid, true);
    const pr = paymentRequired({ url: "https://api.heimdall.fund/v1/check" }, [req]);
    assert.deepEqual(decodeHeader(encodeHeader(pr)), pr);
  });

  it("the SDK client pays a 402 and retries with PAYMENT-SIGNATURE", async () => {
    const { facilitator, payer, pc, usdg, net, req, merchant } = await setup();
    const store = new MemoryStore();
    let paid = 0;
    // a minimal x402 server: 402 without payment, settle and serve with it
    const server = (async (_url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      const sigHeader = h.get("payment-signature");
      if (!sigHeader) {
        return new Response(JSON.stringify({ error: "payment_required" }), { status: 402, headers: { "PAYMENT-REQUIRED": encodeHeader(paymentRequired({ url: "https://api.example.com/x" }, [req])) } });
      }
      const p = decodeHeader<PaymentPayload>(sigHeader)!;
      const r = await settlePayment(facilitator as never, pc as never, p, req, { net, nowSec: Number(await networkHelpers.time.latest()), store });
      if (!r.success) return new Response(JSON.stringify(r), { status: 402 });
      paid++;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "PAYMENT-RESPONSE": encodeHeader(r) } });
    }) as unknown as typeof fetch;
    const f = payX402(server, payer as never, { maxAmount: 5000n, networks: { [net.network]: net } });
    const res = await f("https://api.example.com/x");
    assert.equal(res.status, 200);
    assert.equal(paid, 1);
    assert.equal(await usdg.read.balanceOf([merchant.account.address]), 1000n);
    // over the agent's own cap: the client refuses to sign
    const capped = payX402(server, payer as never, { maxAmount: 999n, networks: { [net.network]: net } });
    await assert.rejects(capped("https://api.example.com/x"), /above your cap/);
  });
});
