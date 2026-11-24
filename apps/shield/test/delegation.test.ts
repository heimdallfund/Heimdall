import { describe, it, expect } from "vitest";
import type { Address, PublicClient } from "viem";
import { checkAuthorization } from "../src/typed.js";
import { checkTransaction } from "../src/shield.js";
import { PolicySchema } from "../src/policy.js";

const METAMASK = "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B";
const EVIL: Address = "0x5555555555555555555555555555555555555555";
const EMPTY: Address = "0x6666666666666666666666666666666666666666";
const DELEGATED: Address = "0x7777777777777777777777777777777777777777";
const client = {
  getCode: async ({ address }: { address: string }) => (address.toLowerCase() === EMPTY.toLowerCase() ? undefined : address.toLowerCase() === DELEGATED.toLowerCase() ? "0xef0100" + "11".repeat(20) : "0x6080"),
  getBalance: async () => 0n,
  readContract: async () => 0n,
  request: async () => [{ calls: [{ status: "0x1", gasUsed: "0x1", logs: [] }] }],
} as unknown as PublicClient;
const p = PolicySchema.parse({});
const verdict = async (address: string, chainId: number | string = 4663, policy = p) => checkAuthorization(4663, { chainId, address, nonce: 0 }, policy, client);

describe("EIP-7702 authorizations", () => {
  it("allows a known wallet implementation and a revoke", async () => {
    const r = await verdict(METAMASK);
    expect(r.verdict).toBe("ALLOW");
    expect(r.summary[0]).toContain("MetaMask");
    expect((await verdict("0x0000000000000000000000000000000000000000")).findings[0]!.code).toBe("AUTH_REVOKE");
  });

  it("denies an unknown delegate unless the policy trusts it", async () => {
    const r = await verdict(EVIL);
    expect(r.verdict).toBe("DENY");
    expect(r.findings.map((f) => f.code)).toContain("UNKNOWN_DELEGATE");
    expect((await verdict(EVIL, 4663, PolicySchema.parse({ trustedDelegates: [EVIL] }))).verdict).toBe("ALLOW");
  });

  it("denies chain 0 (every chain), another chain, an empty address and a delegated wallet", async () => {
    expect((await verdict(METAMASK, 0)).findings.map((f) => f.code)).toContain("AUTH_ALL_CHAINS");
    expect((await verdict(METAMASK, "1")).findings.map((f) => f.code)).toContain("WRONG_CHAIN");
    expect((await verdict(EMPTY)).findings.map((f) => f.code)).toContain("DELEGATE_NO_CODE");
    expect((await verdict(DELEGATED)).findings.map((f) => f.code)).toContain("DELEGATE_IS_WALLET");
  });

  it("judges the authorization list of a type 4 transaction", async () => {
    const r = await checkTransaction({ chainId: 4663, from: "0x1111111111111111111111111111111111111111", to: "0x1111111111111111111111111111111111111111", data: "0x", value: 0n, authorizationList: [{ chainId: 4663, address: EVIL, nonce: 1 }] }, {}, { client, sign: false });
    expect(r.verdict).toBe("DENY");
    expect(r.summary.join(" ")).toContain("EIP-7702");
  });
});
