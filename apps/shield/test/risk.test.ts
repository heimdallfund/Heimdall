import { describe, expect, it } from "vitest";
import { buildRiskList, describe as describeRisk, FLAG, flagNames, flagsFromLabel, LEVEL } from "../src/risk.js";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";

describe("risk list for the onchain oracle", () => {
  it("maps curated labels to flag bits", () => {
    expect(flagsFromLabel({ address: A, label: "Inferno Drainer" })).toBe(FLAG.DRAINER);
    expect(flagsFromLabel({ address: A, label: "Phishing: fake airdrop site" })).toBe(FLAG.PHISHING);
    expect(flagsFromLabel({ address: A, label: "Honeypot token" })).toBe(FLAG.HONEYPOT);
    expect(flagsFromLabel({ address: A, label: "Community report", source: "Guardian report" })).toBe(FLAG.COMMUNITY | FLAG.DRAINER);
    expect(flagsFromLabel({ address: A })).toBe(FLAG.MALICIOUS_CONTRACT); // unlabeled still carries a reason
  });

  it("blocklist entries are BLOCKED, heavy Shield denials are WARN, light ones are left out", () => {
    const list = buildRiskList(
      [{ address: A, label: "Drainer" }, { address: "not-an-address" }],
      [{ address: A, denies: 9 }, { address: B, denies: 5 }, { address: C, denies: 4 }],
    );
    expect(list).toHaveLength(2);
    const a = list.find((e) => e.address.toLowerCase() === A)!;
    expect(a.level).toBe(LEVEL.BLOCKED);
    expect(a.flags).toBe(FLAG.DRAINER | FLAG.SHIELD_DENIED);
    const b = list.find((e) => e.address.toLowerCase() === B)!;
    expect(b.level).toBe(LEVEL.WARN);
    expect(b.flags).toBe(FLAG.SHIELD_DENIED);
    expect(list[0].level).toBe(LEVEL.BLOCKED); // blocked first
  });

  it("describes an address in plain fields", () => {
    const d = describeRisk({ address: A, level: 3, flags: FLAG.DRAINER | FLAG.COMMUNITY, source: "Guardian report" }, A);
    expect(d).toMatchObject({ level: 3, levelName: "blocked", blocked: true, flagNames: ["drainer", "community"] });
    expect(describeRisk(undefined, B)).toMatchObject({ level: 0, levelName: "none", blocked: false, flagNames: [] });
    expect(flagNames(0)).toEqual([]);
  });
});
