import { describe, expect, it } from "vitest";
import { devHistoryFindings, type DevHistory } from "../src/devhistory.js";

const h = (o: Partial<DevHistory>): DevHistory => ({ launches: 0, checked: 0, graduated: 0, dumped: 0, dead: 0, active: 0, recent: [], ...o });

describe("dev track record", () => {
  it("denies a dev who dumped five or more earlier launches and warns on three of four", () => {
    expect(devHistoryFindings(h({ launches: 9, checked: 9, dumped: 8, active: 1 }))[0]).toMatchObject({ code: "SERIAL_DUMPER", severity: "deny" });
    expect(devHistoryFindings(h({ launches: 4, checked: 4, dumped: 3, active: 1 }))[0]).toMatchObject({ code: "SERIAL_DUMPER", severity: "warn" });
  });
  it("is a plain note for a dev whose earlier tokens graduated, and silent for a first launch", () => {
    expect(devHistoryFindings(h({ launches: 2, checked: 2, graduated: 2 }))[0]).toMatchObject({ code: "DEV_HISTORY", severity: "info" });
    expect(devHistoryFindings(h({ launches: 2, checked: 2, graduated: 2 }))[0]!.message).toContain("2 graduated");
    expect(devHistoryFindings(h({}))).toEqual([]);
  });
});
