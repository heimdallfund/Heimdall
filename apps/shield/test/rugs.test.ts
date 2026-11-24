import { describe, expect, it } from "vitest";
import { noteOutcome, recordSeen, rugLog, sweepRugs } from "../src/rugs.js";
import { MemoryStore } from "../src/store.js";
import type { TokenCheck } from "../src/tokencheck.js";

const tc = (verdict: TokenCheck["verdict"], findings: TokenCheck["findings"] = []) =>
  ({ symbol: "T", name: "Token", verdict, riskScore: verdict === "ALLOW" ? 0 : 40, findings, holders: null, launch: { launchpad: "Pons" } }) as unknown as TokenCheck;
const lp = { code: "LP_REMOVABLE", severity: "warn" as const, message: "The pool's liquidity can be pulled." };
const rug = { code: "LIQUIDITY_REMOVED", severity: "deny" as const, message: "Liquidity was removed." };
const min = 60_000;

describe("rug log", () => {
  it("files a rug with the verdict from before, and only for tokens first seen alive", async () => {
    const s = new MemoryStore();
    await recordSeen(s, "0xA", tc("WARN", [lp]), 0);
    await recordSeen(s, "0xA", tc("ALLOW"), 1); // the first check stays the "before"
    await recordSeen(s, "0xB", tc("ALLOW"), 0);
    await recordSeen(s, "0xC", tc("DENY", [rug]), 0); // already dead when first seen: never listed
    expect(await noteOutcome(s, "0xA", tc("DENY", [rug]), 1 * min)).toBeNull(); // too soon after the first check
    const e = await noteOutcome(s, "0xA", tc("DENY", [rug]), 30 * min);
    expect(e).toMatchObject({ kind: "rugged", venue: "Pons", before: { verdict: "WARN", flags: ["LP_REMOVABLE"], at: 0 } });
    expect(await noteOutcome(s, "0xA", tc("DENY", [rug]), 31 * min)).toBeNull(); // filed once
    await noteOutcome(s, "0xB", tc("WARN", [{ code: "HONEYPOT", severity: "deny", message: "Sells revert." }]), 40 * min);
    expect(await noteOutcome(s, "0xC", tc("DENY", [rug]), 40 * min)).toBeNull();
    const log = await rugLog(s);
    expect(log).toMatchObject({ total: 2, flagged: 1, passed: 1, lpWarned: 1 });
    expect(log.events.map((x) => x.kind)).toEqual(["honeypot", "rugged"]); // newest first
  });

  it("re-checks risky tokens sooner, and stops watching after three days or a rug", async () => {
    const s = new MemoryStore();
    await recordSeen(s, "0xR", tc("WARN", [lp]), 0);
    await recordSeen(s, "0xS", tc("ALLOW"), 0);
    const seen: string[] = [];
    const now: Record<string, TokenCheck> = { "0xr": tc("DENY", [rug]), "0xs": tc("ALLOW") };
    const check = async (t: string) => { seen.push(t); return now[t]!; };
    let x = await sweepRugs(s, check, { now: 15 * min });
    expect(seen).toEqual(["0xr"]); // risky: due after 10 minutes, the other after 45
    expect(x.found.map((e) => e.token)).toEqual(["0xr"]);
    x = await sweepRugs(s, check, { now: 50 * min });
    expect(seen).toEqual(["0xr", "0xs"]); // the rugged one is no longer watched
    expect(x.watching).toBe(1);
    x = await sweepRugs(s, check, { now: 73 * 60 * min });
    expect(x.watching).toBe(0);
  });
});
