import { describe, it, expect } from "vitest";
import { encodeFunctionData, parseAbi } from "viem";
import { MemoryStore } from "../src/store.js";
import { bindReferral, claimAction, earlyStatus, referralCode, referralStats, registerEarly, rememberCode } from "../src/growth.js";
import { award, RULES, walletPoints } from "../src/points.js";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", Z = "0x0000000000000000000000000000000000000abc";
const STAKING = "0x1111111111111111111111111111111111111111", PAY = "0x2222222222222222222222222222222222222222";
const env = { HEIMDALL_STAKING_ADDRESS: STAKING, HEIMDALL_PAY_ADDRESS: PAY } as NodeJS.ProcessEnv;
const client = (nonce = 3, txs: Record<string, { from: string; to: string; input: string; ok?: boolean }> = {}) => ({
  getTransactionCount: async () => nonce,
  getTransactionReceipt: async ({ hash }: { hash: string }) => ({ status: txs[hash]?.ok === false ? "reverted" : "success", logs: [] }),
  getTransaction: async ({ hash }: { hash: string }) => txs[hash],
}) as never;
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

describe("early access", () => {
  it("registers wallets with onchain history once, with points, and refuses empty wallets", async () => {
    const s = new MemoryStore();
    expect((await registerEarly(s, client(0), A, { env })).ok).toBe(false);
    const r = await registerEarly(s, client(), A, { env });
    expect(r).toMatchObject({ ok: true, already: false, points: RULES.early });
    expect((await registerEarly(s, client(), A, { env }) as { already?: boolean }).already).toBe(true);
    expect((await walletPoints(s, A)).breakdown.early).toBe(RULES.early);
    expect((await earlyStatus(s, env)).count).toBe(1);
  });
  it("limits sign-ups per network and closes after EARLY_ACCESS_UNTIL", async () => {
    const s = new MemoryStore();
    const wallets = [1, 2, 3, 4].map((i) => `0x${String(i).repeat(40)}`);
    const res = [];
    for (const w of wallets) res.push((await registerEarly(s, client(), w, { env, ipKey: "same" })).ok);
    expect(res).toEqual([true, true, true, false]);
    const closed = await registerEarly(s, client(), A, { env: { ...env, EARLY_ACCESS_UNTIL: "2020-01-01T00:00:00Z" } });
    expect(closed).toMatchObject({ ok: false, error: "closed" });
  });
});

describe("referrals", () => {
  it("pays the inviter only when the invited wallet really uses a product", async () => {
    const s = new MemoryStore();
    const code = await rememberCode(s, A);
    expect(code).toBe(referralCode(A));
    expect((await bindReferral(s, A, code)).reason).toBe("self");
    expect((await bindReferral(s, B, code)).ok).toBe(true);
    expect((await bindReferral(s, B, code)).reason).toBe("already_invited");
    await award(s, B, "revoke", 50, "x1");                     // farmable: does not qualify
    expect((await referralStats(s, A)).qualified).toBe(0);
    await award(s, B, "deposit", 3, "d1");                      // real use
    expect(await referralStats(s, A)).toMatchObject({ invited: 1, qualified: 1, points: RULES.referral });
    expect((await walletPoints(s, B)).breakdown.referral).toBe(RULES.welcome);
    await award(s, B, "deposit", 3, "d2");                      // once only
    expect((await referralStats(s, A)).points).toBe(RULES.referral);
  });
  it("refuses wallets that were already active, and caps paid invites", async () => {
    const s = new MemoryStore();
    const code = await rememberCode(s, A);
    await award(s, B, "action", 25, "a1");
    expect((await bindReferral(s, B, code)).reason).toBe("not_new");
    for (let i = 0; i < RULES.referralCap + 2; i++) {
      const w = `0x${(1000 + i).toString(16).padStart(40, "0")}`;
      await bindReferral(s, w, code);
      await award(s, w, "action", 25, `a:${w}`);
    }
    const st = await referralStats(s, A);
    expect(st.qualified).toBe(RULES.referralCap + 2);
    expect(st.points).toBe(RULES.referral * RULES.referralCap);
  });
});

describe("verified actions", () => {
  it("rewards a first real stake and a first real Pay job, checked from the transaction", async () => {
    const s = new MemoryStore();
    const stake = (n: bigint) => encodeFunctionData({ abi: parseAbi(["function stake(uint256)"]), functionName: "stake", args: [n] });
    const job = (provider: string, amount: bigint) => encodeFunctionData({ abi: parseAbi(["function createJob(address,address,uint96,uint64,uint32,uint16,bytes32)"]), functionName: "createJob", args: [provider as `0x${string}`, Z, amount, 1n, 3600, 0, H(9)] });
    const txs = {
      [H(1)]: { from: A, to: STAKING, input: stake(10n ** 18n) },
      [H(2)]: { from: A, to: STAKING, input: stake(5_000n * 10n ** 18n) },
      [H(3)]: { from: A, to: PAY, input: job(A, 50_000_000n) },
      [H(4)]: { from: A, to: PAY, input: job(B, 50_000_000n) },
      [H(5)]: { from: B, to: STAKING, input: stake(5_000n * 10n ** 18n) },
      [H(6)]: { from: A, to: Z, input: "0x" },
    };
    const c = client(3, txs);
    expect(await claimAction(s, c, A, H(1), env)).toMatchObject({ awarded: 0, error: "below_minimum" });
    expect(await claimAction(s, c, A, H(2), env)).toMatchObject({ kind: "stake", awarded: RULES.stake });
    expect(await claimAction(s, c, A, H(2), env)).toMatchObject({ awarded: 0 });          // once
    expect(await claimAction(s, c, A, H(3), env)).toMatchObject({ error: "self_job" });
    expect(await claimAction(s, c, A, H(4), env)).toMatchObject({ kind: "pay", awarded: RULES.pay });
    expect(await claimAction(s, c, A, H(5), env)).toMatchObject({ error: "not_sender" });
    expect(await claimAction(s, c, A, H(6), env)).toMatchObject({ error: "not_a_heimdall_action" });
  });
});

describe("growth admin view", () => {
  it("counts sign-ups and invites per day and flags an inviter whose invitees look farmed", async () => {
    const { growthStats, registerEarly, rememberCode } = await import("../src/growth.js");
    const { MemoryStore } = await import("../src/store.js");
    const store = new MemoryStore();
    const client = { getTransactionCount: async () => 1 } as never;
    const inviter = "0x1000000000000000000000000000000000000001";
    await registerEarly(store, { getTransactionCount: async () => 40 } as never, inviter, { ipKey: "net-a" });
    const code = await rememberCode(store, inviter);
    for (let i = 2; i < 8; i++) await registerEarly(store, client, `0x${String(i).padStart(40, "0")}`, { ipKey: i < 5 ? "net-b" : `net-${i}`, code });
    const g = await growthStats(store, 3);
    expect(g.series.at(-1)).toMatchObject({ signups: 7, invites: 6, qualified: 0 });
    expect(g.totals).toMatchObject({ early: 7, inviters: 1, invited: 6, qualified: 0 });
    expect(g.top[0]).toMatchObject({ inviter, invited: 6 });
    expect(g.flagged[0]!.flags.join(" ")).toMatch(/none used Heimdall/);
    expect(g.flagged[0]!.flags.join(" ")).toMatch(/one network/);
    expect(g.flagged[0]!.flags.join(" ")).toMatch(/1–2 transactions/);
    const again = await registerEarly(store, client, inviter, {});
    expect(JSON.stringify(again)).not.toMatch(/net-a|nonce/);
  });
});
