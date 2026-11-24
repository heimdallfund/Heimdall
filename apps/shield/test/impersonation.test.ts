import { describe, it, expect } from "vitest";
import { impersonates, normalizeTicker } from "../src/impersonation.js";

const NVDA = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";
const FAKE = "0x4444444444444444444444444444444444444444";

describe("fake token detection", () => {
  it("folds case, spaces, punctuation, zero-width and look-alike letters", () => {
    expect(normalizeTicker("U S D G")).toBe("usdg");
    expect(normalizeTicker("USDG​")).toBe("usdg");
    expect(normalizeTicker("UЅDG")).toBe("usdg"); // Cyrillic DZE
    expect(normalizeTicker("NVDА")).toBe("nvda"); // Cyrillic A
    expect(normalizeTicker("$TSLA")).toBe("tsla");
  });

  it("flags a known ticker at another address, by symbol first, then by name", () => {
    expect(impersonates(FAKE, "NVDA", "Whatever")).toMatchObject({ symbol: "NVDA", real: NVDA, by: "symbol" });
    expect(impersonates(FAKE, "UЅDG")).toMatchObject({ symbol: "USDG", by: "symbol" });
    expect(impersonates(FAKE, "TSLA2", "Tesla")).toMatchObject({ symbol: "TSLA", by: "name" });
  });

  it("leaves the real token and unrelated tokens alone", () => {
    expect(impersonates(NVDA, "NVDA", "NVIDIA")).toBeUndefined();
    expect(impersonates(FAKE, "CASHCAT", "Cash Cat")).toBeUndefined();
    expect(impersonates(FAKE, "UNKNOWN")).toBeUndefined();
    expect(impersonates(FAKE, "NVDAX", "Some meme")).toBeUndefined();
  });
});
