import type { Page } from "@playwright/test";

/**
 * A stand-in browser wallet (EIP-1193) for one of the fork node's unlocked accounts. Reads and writes go straight to the
 * node, which signs for its own accounts, so every click in the app ends in a real transaction on the fork.
 */
export async function useWallet(page: Page, account: string, rpc = process.env.E2E_RPC ?? "http://127.0.0.1:8545") {
  await page.addInitScript(({ account, rpc }) => {
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
    let id = 0;
    const call = async (method: string, params: unknown[] = []) => {
      const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
      const body = await res.json();
      if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code, data: body.error.data });
      return body.result;
    };
    const ethereum = {
      isMetaMask: false,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        switch (method) {
          case "eth_requestAccounts": case "eth_accounts": return [account];
          case "wallet_switchEthereumChain": case "wallet_addEthereumChain": return null;
          case "wallet_requestPermissions": return [{ parentCapability: "eth_accounts" }];
          case "wallet_getPermissions": return [{ parentCapability: "eth_accounts" }];
          case "eth_sendTransaction": {
            const [tx] = params as [Record<string, unknown>];
            return call(method, [{ ...tx, from: account }]);
          }
          default: return call(method, params ?? []);
        }
      },
      on: (e: string, fn: (...a: unknown[]) => void) => { (listeners[e] ??= []).push(fn); },
      removeListener: (e: string, fn: (...a: unknown[]) => void) => { listeners[e] = (listeners[e] ?? []).filter((f) => f !== fn); },
    };
    Object.defineProperty(window, "ethereum", { value: ethereum, configurable: true });
  }, { account, rpc });
}

export async function connect(page: Page) {
  const btn = page.locator("main").getByRole("button", { name: "Connect wallet" }).first();
  await btn.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (await btn.isVisible().catch(() => false)) await btn.click();
  // the wallet picker: choose the wallet injected in this browser (the test's stand-in)
  const tile = page.getByRole("dialog", { name: "Connect a wallet" }).getByRole("button").filter({ hasText: "In this browser" }).first();
  if (await tile.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false)) await tile.click();
  await btn.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
}

export async function rpc(method: string, params: unknown[] = []) {
  const res = await fetch(process.env.E2E_RPC ?? "http://127.0.0.1:8545", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
