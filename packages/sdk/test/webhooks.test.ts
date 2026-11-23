import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { parseWebhook, verifyWebhook } from "../src/index.js";

const sign = (secret: string, body: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

describe("verifyWebhook", () => {
  it("accepts Heimdall's signature and rejects tampering, wrong secrets and replays", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "shield.deny", createdAt: "2026-11-23T00:00:00Z", data: {} });
    expect(await verifyWebhook({ secret: "whsec_a", body, signature: sign("whsec_a", body) })).toBe(true);
    expect(await verifyWebhook({ secret: "whsec_b", body, signature: sign("whsec_a", body) })).toBe(false);
    expect(await verifyWebhook({ secret: "whsec_a", body: body.replace("deny", "warn"), signature: sign("whsec_a", body) })).toBe(false);
    expect(await verifyWebhook({ secret: "whsec_a", body, signature: sign("whsec_a", body, Math.floor(Date.now() / 1000) - 900) })).toBe(false);
    expect(await verifyWebhook({ secret: "whsec_a", body, signature: undefined })).toBe(false);
    expect((await parseWebhook({ secret: "whsec_a", body, signature: sign("whsec_a", body) })).type).toBe("shield.deny");
    await expect(parseWebhook({ secret: "x", body, signature: "t=1,v1=00" })).rejects.toThrow(/signature/);
  });
});
