import { describe, it, expect } from "vitest";
import type { PublicClient } from "viem";
import { HeimdallPay, hashOf } from "../src/index.js";

describe("HeimdallPay SDK", () => {
  it("maps job status and lists jobs newest first", async () => {
    const client = {
      readContract: async ({ functionName, args }: { functionName: string; args: unknown[] }) => {
        if (functionName === "jobsOfProvider") return [0n, 1n];
        if (functionName === "getJob") return { client: "0x1", provider: "0x2", amount: 5_000_000n, status: args[0] === 1n ? 2 : 4 };
        return 3n;
      },
    } as unknown as PublicClient;
    const pay = new HeimdallPay("0x0000000000000000000000000000000000000009", client);
    const jobs = await pay.jobsOf("0x0000000000000000000000000000000000000002", "provider");
    expect(jobs.map((j) => [j.id, j.status])).toEqual([[1n, "Submitted"], [0n, "Released"]]);
    expect(await pay.record("0x0000000000000000000000000000000000000002")).toEqual({ completed: 3n, disputed: 3n, earned: 3n });
    expect(hashOf("a")).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
