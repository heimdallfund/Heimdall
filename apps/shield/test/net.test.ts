import { describe, expect, it } from "vitest";
import { isPrivateIp, publicUrlProblem, readCapped } from "../src/net.js";
import { readRegistration } from "../src/passport.js";
import { CheckBody } from "../src/server.js";

const resolveTo = (...ips: string[]) => async () => ips;

describe("outbound requests stay on the public internet", () => {
  it("knows private, loopback, link-local, carrier-grade NAT and mapped addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe"]) {
      expect([ip, isPrivateIp(ip)]).toEqual([ip, true]);
    }
    for (const ip of ["8.8.8.8", "104.18.2.3", "172.32.0.1", "2606:4700::1111"]) expect([ip, isPrivateIp(ip)]).toEqual([ip, false]);
  });

  it("refuses http, credentials, private names and public names that resolve to private addresses", async () => {
    expect(await publicUrlProblem("http://hooks.example.com/x", { resolve: resolveTo("8.8.8.8") })).toBe("https only");
    expect(await publicUrlProblem("https://u:p@hooks.example.com/x", { resolve: resolveTo("8.8.8.8") })).toBe("credentials in the URL");
    expect(await publicUrlProblem("https://metadata.internal/x")).toBe("private hostname");
    expect(await publicUrlProblem("https://[::ffff:127.0.0.1]/x")).toBe("private address");
    expect(await publicUrlProblem("https://2130706433/x")).toBe("private address"); // 127.0.0.1 written as a number
    expect(await publicUrlProblem("https://rebind.example.com/x", { resolve: resolveTo("8.8.8.8", "10.0.0.5") })).toBe("resolves to a private address");
    expect(await publicUrlProblem("https://hooks.example.com/x", { resolve: resolveTo("93.184.215.14") })).toBeNull();
  });

  it("an agent registration file on a private address is never fetched", async () => {
    let fetched = 0;
    const fetcher = (async () => { fetched++; return new Response("{}"); }) as typeof fetch;
    expect(await readRegistration("https://agent.example.com/reg.json", fetcher, { resolve: resolveTo("169.254.169.254") })).toBeNull();
    expect(fetched).toBe(0);
    const ok = (async () => new Response(JSON.stringify({ name: "Agent" }))) as typeof fetch;
    expect((await readRegistration("https://agent.example.com/reg.json", ok, { resolve: resolveTo("8.8.8.8") }))?.name).toBe("Agent");
  });

  it("stops reading a body past the cap, even without a content-length", async () => {
    const big = new Response(new ReadableStream({ start(c) { for (let i = 0; i < 100; i++) c.enqueue(new Uint8Array(1024)); c.close(); } }));
    expect(await readCapped(big, 64_000)).toBeNull();
    expect(await readCapped(new Response("small"), 64_000)).toBe("small");
  });

  it("a transaction value must fit in uint256", () => {
    const base = { from: "0x1111111111111111111111111111111111111111", to: "0x2222222222222222222222222222222222222222" };
    expect(CheckBody.safeParse({ ...base, value: "9".repeat(200) }).success).toBe(false);
    expect(CheckBody.safeParse({ ...base, value: (2n ** 256n).toString() }).success).toBe(false);
    expect(CheckBody.safeParse({ ...base, value: "-1" }).success).toBe(false);
    expect(CheckBody.safeParse({ ...base, value: (2n ** 256n - 1n).toString() }).success).toBe(true);
  });
});
