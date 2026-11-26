import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("agent copy", () => {
  it.each(["agent.ts", "router.ts", "strategy.ts", "run.ts"])("%s matches apps/agent (run: node scripts/sync-agent.mjs)", (f) => {
    expect(readFileSync(new URL(`../src/agent/${f}`, import.meta.url), "utf8")).toBe(readFileSync(new URL(`../../agent/src/${f}`, import.meta.url), "utf8"));
  });
});
