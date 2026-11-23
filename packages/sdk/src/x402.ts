import { getAddress, toHex, type Address, type Hex, type WalletClient } from "viem";

/**
 * x402 client: wrap fetch so a 402 Payment Required is paid in USDG (EIP-3009, gasless for the payer) and the request
 * is retried. Works with Heimdall's API and any x402 server on Robinhood Chain.
 *
 *     const pay = payX402(fetch, wallet, { maxAmount: 10_000n }); // at most 0.01 USDG per call
 *     const res = await pay("https://api.heimdall.fund/v1/check", { method: "POST", body });
 */

export interface X402Asset { chainId: number; network: string; asset: Address; name: string; version: string }

export const X402_ROBINHOOD_USDG: X402Asset = {
  chainId: 4663,
  network: "eip155:4663",
  asset: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  name: "Global Dollar",
  version: "1",
};

export interface PayX402Options {
  /** Most the client will pay for one request, in raw units (USDG has 6 decimals). Required: no open-ended spending. */
  maxAmount: bigint;
  /** Networks and assets the wallet may pay with. Default: USDG on Robinhood Chain. */
  networks?: Record<string, X402Asset>;
  /** Called after each payment with what was paid and the server's settlement header, if any. */
  onPay?: (p: { url: string; amount: bigint; payTo: Address; network: string; settlement: unknown }) => void;
}

interface Requirement { scheme: string; network: string; amount?: string; maxAmountRequired?: string; asset: string; payTo: string; maxTimeoutSeconds?: number; extra?: Record<string, unknown> }

const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const b64 = (o: unknown) => (typeof Buffer !== "undefined" ? Buffer.from(JSON.stringify(o)).toString("base64") : btoa(JSON.stringify(o)));
const unb64 = (s: string) => JSON.parse(typeof Buffer !== "undefined" ? Buffer.from(s, "base64").toString("utf8") : atob(s));

/** Read what a 402 asks for: the v2 PAYMENT-REQUIRED header, or a v1 JSON body with `accepts`. */
export async function readPaymentRequired(res: Response): Promise<{ x402Version: number; resource?: unknown; accepts: Requirement[]; extensions?: unknown } | null> {
  const h = res.headers.get("payment-required");
  if (h) {
    try { return unb64(h); } catch { /* fall through */ }
  }
  const body = await res.clone().json().catch(() => null);
  return body && Array.isArray(body.accepts) ? body : null;
}

export class X402Error extends Error {
  constructor(message: string, readonly detail?: unknown) { super(message); this.name = "X402Error"; }
}

export function payX402(fetchImpl: typeof fetch, wallet: WalletClient, opts: PayX402Options): typeof fetch {
  const networks = opts.networks ?? { [X402_ROBINHOOD_USDG.network]: X402_ROBINHOOD_USDG, robinhood: X402_ROBINHOOD_USDG };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const first = await fetchImpl(input as never, init);
    if (first.status !== 402) return first;
    const pr = await readPaymentRequired(first);
    if (!pr) throw new X402Error("402 without payment requirements");
    const account = wallet.account;
    if (!account) throw new X402Error("wallet has no account");

    const usable = pr.accepts.filter((r) => r.scheme === "exact" && networks[r.network] && networks[r.network]!.asset.toLowerCase() === String(r.asset).toLowerCase());
    if (!usable.length) throw new X402Error("no payment option this wallet can use", pr.accepts);
    const cheapest = usable.map((r) => ({ r, amount: BigInt(r.amount ?? r.maxAmountRequired ?? "0") })).sort((a, b) => (a.amount < b.amount ? -1 : 1))[0]!;
    if (cheapest.amount > opts.maxAmount) throw new X402Error(`price ${cheapest.amount} is above your cap of ${opts.maxAmount}`, cheapest.r);

    const net = networks[cheapest.r.network]!;
    const now = Math.floor(Date.now() / 1000);
    const nonceBytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(nonceBytes);
    const authorization = {
      from: getAddress(account.address),
      to: getAddress(cheapest.r.payTo),
      value: cheapest.amount,
      validAfter: 0n,
      validBefore: BigInt(now + Math.max(60, cheapest.r.maxTimeoutSeconds ?? 60)),
      nonce: toHex(nonceBytes) as Hex,
    };
    const signature = await wallet.signTypedData({
      account,
      domain: { name: net.name, version: net.version, chainId: net.chainId, verifyingContract: net.asset },
      types: TYPES,
      primaryType: "TransferWithAuthorization",
      message: authorization,
    });
    const auth = { ...authorization, value: String(authorization.value), validAfter: "0", validBefore: String(authorization.validBefore) };
    const v2 = { x402Version: 2, resource: pr.resource, accepted: { ...cheapest.r, amount: String(cheapest.amount) }, payload: { signature, authorization: auth }, extensions: pr.extensions };
    const v1 = { x402Version: 1, scheme: "exact", network: cheapest.r.network, payload: { signature, authorization: auth } };

    const headers = new Headers(init?.headers);
    if (pr.x402Version === 1) headers.set("X-PAYMENT", b64(v1));
    else headers.set("PAYMENT-SIGNATURE", b64(v2));
    const paid = await fetchImpl(input as never, { ...init, headers });
    const settled = paid.headers.get("payment-response") ?? paid.headers.get("x-payment-response");
    opts.onPay?.({ url: String(input), amount: cheapest.amount, payTo: authorization.to, network: cheapest.r.network, settlement: settled ? (() => { try { return unb64(settled); } catch { return settled; } })() : null });
    return paid;
  }) as typeof fetch;
}
