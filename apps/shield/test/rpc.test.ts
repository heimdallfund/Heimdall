import { describe, it, expect, afterAll } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { activeProvider, clientFor, providerName } from "../src/server.js";
import { status } from "../src/status.js";
import { MemoryStore } from "../src/store.js";

const server = createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
    const { id } = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id, result: "0x2a" }));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const backup = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
afterAll(() => server.close());

describe("RPC fallback", () => {
  it("names providers without exposing keys", () => {
    expect(providerName("https://robinhood-mainnet.g.alchemy.com/v2/SECRET")).toBe("Alchemy");
    expect(providerName("https://x.robinhood-mainnet.quiknode.pro/SECRET/")).toBe("QuickNode");
    expect(providerName("https://rpc.mainnet.chain.robinhood.com")).toBe("Robinhood public RPC");
  });

  it("moves to the backup when the main provider is down, and reports it", async () => {
    const c = clientFor(46630, { RPC_URL_TESTNET: "http://127.0.0.1:9/", RPC_URL_TESTNET_BACKUP: backup } as NodeJS.ProcessEnv);
    expect(await c.getBlockNumber()).toBe(42n);
    expect(activeProvider(46630)).toMatchObject({ name: "Local node", primary: false });
  });

  it("shows a backup provider as degraded on the status page", async () => {
    const s = await status(new MemoryStore(), async () => ({ block: 10n, timestamp: BigInt(Math.floor(Date.now() / 1000)), provider: { name: "QuickNode", primary: false } }));
    const rpc = s.services.find((x) => x.id === "rpc")!;
    expect(rpc.state).toBe("degraded");
    expect(rpc.detail).toMatch(/via QuickNode \(backup\)/);
  });
});
