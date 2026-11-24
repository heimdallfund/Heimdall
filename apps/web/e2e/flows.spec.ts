import { test, expect } from "@playwright/test";
import { encodeFunctionData, erc20Abi, parseAbi } from "viem";
import { connect, rpc, useWallet } from "./wallet";

const E = JSON.parse(process.env.E2E_ENV ?? "{}") as Record<string, `0x${string}`>;
const DRAINER = "0x000000000000000000000000000000000000bEEF";
const receipt = async (hash: string) => { for (let i = 0; i < 50; i++) { const r = await rpc("eth_getTransactionReceipt", [hash]); if (r) return r; await new Promise((s) => setTimeout(s, 200)); } throw new Error("no receipt"); };

test.describe.configure({ mode: "serial" });

test("Wallet Check finds a risky approval and the owner revokes it", async ({ page }) => {
  // a cold fork fetches every token's mainnet state on first read, which can take minutes
  test.setTimeout(420_000);
  // the client wallet gives an unlimited USDG approval to an unknown address
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [DRAINER, 2n ** 256n - 1n] });
  await receipt(await rpc("eth_sendTransaction", [{ from: E.CLIENT, to: E.USDG, data }]));
  // Warm the report first: a cold fork can take ~1 min to fetch mainnet state, longer than the page waits.
  await fetch(`http://127.0.0.1:8899/v1/wallet/${E.CLIENT}`, { signal: AbortSignal.timeout(300_000) }).catch(() => {});
  await useWallet(page, E.CLIENT);
  await page.goto("/check");
  await page.getByPlaceholder("0x… any Robinhood Chain wallet").fill(E.CLIENT);
  await page.getByRole("button", { name: "Check wallet" }).click();
  await expect(page).toHaveURL(new RegExp(`/check/${E.CLIENT}`, "i"));
  await expect(page.getByText(/0x0000…beef|0x0000\.\.\.beef/i).first()).toBeVisible({ timeout: 90_000 });
  await connect(page);
  await page.getByRole("button", { name: /^Revoke$/ }).first().click();
  await expect(page.getByText(/^Revoked/)).toBeVisible();
  const left = await rpc("eth_call", [{ to: E.USDG, data: encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [E.CLIENT, DRAINER] }) }, "latest"]);
  expect(BigInt(left)).toBe(0n);
});

test("Heimdall Pay: a client escrows USDG for a job", async ({ page }) => {
  await useWallet(page, E.CLIENT);
  await page.goto("/app/pay");
  await connect(page);
  await page.getByLabel("Provider wallet").fill(E.PROVIDER);
  await page.getByLabel("Amount (USDG)").fill("5");
  await page.getByLabel("Task").fill("Summarise NVDA's latest 10-Q in five bullet points.");
  await page.getByRole("button", { name: /Escrow 5 USDG/ }).click();
  await expect(page.getByText("Job created and funded.", { exact: false })).toBeVisible();
  const count = await rpc("eth_call", [{ to: E.PAY, data: encodeFunctionData({ abi: parseAbi(["function jobCount() view returns (uint256)"]), functionName: "jobCount" }) }, "latest"]);
  expect(BigInt(count)).toBe(1n);
});

test("Auto-Invest: a plan is created from the user's wallet", async ({ page }) => {
  await useWallet(page, E.CLIENT);
  await page.goto("/invest");
  await connect(page);
  await page.getByLabel("Amount per buy (USDG)").fill("10");
  await page.getByLabel("Number of buys").fill("4");
  await page.getByRole("button", { name: "Start plan" }).click();
  await expect(page.getByText(/buys? left/)).toBeVisible();
});

test("Stake: $HEIM is staked and still counts for holder benefits", async ({ page }) => {
  await useWallet(page, E.STAKER);
  await page.goto("/stake");
  await connect(page);
  await page.getByLabel("Amount (HEIM)").fill("200000");
  await page.getByRole("button", { name: "Stake", exact: true }).click();
  await expect(page.getByText("Staked.", { exact: true })).toBeVisible();
  const held = await rpc("eth_call", [{ to: E.HOLDER, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [E.STAKER] }) }, "latest"]);
  expect(BigInt(held)).toBe(250_000n * 10n ** 18n);
});

test("Admin: the key opens the panel, seasons save, keeper numbers load", async ({ page }) => {
  await page.goto("/admin");
  await page.waitForLoadState("networkidle"); // the form only works once React has hydrated
  await page.getByLabel("Admin key").fill(process.env.E2E_ADMIN_KEY ?? "");
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Add season" }).click();
  await page.getByRole("button", { name: "Save seasons" }).click();
  await expect(page.getByText("Saved. The public Arena board uses these now.")).toBeVisible();
  await expect(page.getByText("Auto-Invest buys due now")).toBeVisible();
  await expect(page.getByText(/\d+ of 1 plans/)).toBeVisible();
});

test("Early access: a wallet with history joins and gets an invite link", async ({ page }) => {
  await useWallet(page, E.CLIENT);
  await page.goto("/early");
  await connect(page);
  await page.getByRole("button", { name: /Sign in and join|Join early access/ }).click();
  await expect(page.getByText(/You're in\. \+100 Guardian Points|You're already on the list\./)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/\/r\/[0-9a-z]{8}/).first()).toBeVisible();
});

test("Status: an incident posted from the admin API shows on the public page", async ({ page }) => {
  const title = `E2E incident ${Date.now()}`;
  const r = await fetch("http://127.0.0.1:8899/v1/admin/incidents", { method: "POST", headers: { "content-type": "application/json", "x-admin-key": process.env.E2E_ADMIN_KEY ?? "" }, body: JSON.stringify({ title, status: "investigating", body: "Wallet Check is slow for some users." }) });
  expect(r.ok).toBe(true);
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "Status" })).toBeVisible();
  await expect(page.getByText("Robinhood Chain RPC").first()).toBeVisible();
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByText("Part of Heimdall is down")).toBeVisible();
});

test("Webhook: a key owner saves an endpoint and a signed test event arrives", async ({ page }) => {
  const { createServer } = await import("node:http");
  const got: { sig: string; body: string }[] = [];
  const server = createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { got.push({ sig: String(req.headers["heimdall-signature"] ?? ""), body: b }); res.end("ok"); }); });
  await new Promise<void>((r) => server.listen(8977, "127.0.0.1", r));
  try {
    await useWallet(page, E.PROVIDER);
    await page.goto("/app/keys");
    await connect(page);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Endpoint URL").fill("http://127.0.0.1:8977/heimdall");
    await page.getByLabel(/Wallets to watch/).fill(E.PROVIDER);
    await page.getByRole("button", { name: "Create webhook" }).click();
    await expect(page.getByText("Signing secret: copy it now", { exact: false })).toBeVisible();
    const secret = (await page.locator("code", { hasText: "whsec_" }).first().textContent())!.trim();
    await page.getByRole("button", { name: "Send test event" }).click();
    await expect(page.getByText(/Test delivered: HTTP 200/)).toBeVisible();
    expect(got).toHaveLength(1);
    const { verifyWebhook } = await import("../../../packages/sdk/src/webhooks");
    expect(await verifyWebhook({ secret, body: got[0]!.body, signature: got[0]!.sig })).toBe(true);
  } finally { server.close(); }
});

test("Shield console: the drainer approval preset is denied before signing", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/app/shield");
  await page.getByRole("button", { name: /Drainer approval/ }).click();
  await page.getByRole("button", { name: "Run check" }).click();
  await expect(page.getByText("DENY").first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/plain wallet|blocklist/i).first()).toBeVisible();
});

test("Vaults: a manager creates a vault from the browser", async ({ page }) => {
  await useWallet(page, E.PROVIDER);
  await page.goto("/vaults/new");
  await connect(page);
  await page.getByLabel("Vault name").fill("E2E Balanced");
  await page.getByLabel("Share symbol").fill("hE2E");
  await page.getByRole("button", { name: "Create vault" }).click();
  await expect(page.getByRole("heading", { name: "Vault created" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "Open the vault page" }).click();
  await expect(page.getByText("E2E Balanced").first()).toBeVisible({ timeout: 60_000 });
});

test("Signals: a provider lists a signal and gets its ID", async ({ page }) => {
  await useWallet(page, E.PROVIDER);
  await page.goto("/signals/new");
  await connect(page);
  await page.getByLabel("Name").fill("E2E earnings drift");
  await page.getByLabel("Price per call (USDG)").fill("0.01");
  await page.getByLabel("What agents get").fill("A daily drift score for NVDA around earnings.");
  await page.getByLabel("Endpoint (HTTPS)").fill("https://signals.example.com/v1/drift");
  await page.getByRole("button", { name: "List signal" }).click();
  await expect(page.getByRole("heading", { name: /Signal #\d+ is live/ })).toBeVisible({ timeout: 60_000 });
});

test("Risk Oracle: a blocklisted address shows as blocked", async ({ page }) => {
  await page.goto("/oracle");
  await page.getByLabel("Address").fill("0x281FF81dF0Eca1F3F7Ba2A48499c7A83D216a2A8");
  await page.getByLabel("Address").press("Enter");
  await expect(page.getByText(/Level 3 · blocked/i)).toBeVisible({ timeout: 60_000 });
});

test("Passport: a wallet lookup opens the agent's profile with its Shield record", async ({ page }) => {
  await page.goto("/passport");
  await page.getByLabel("Agent wallet or id").fill(E.CLIENT);
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page).toHaveURL(new RegExp(`/agent/${E.CLIENT}`, "i"), { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
});

// The fork (anvil) has no eth_simulateV1, so this checks the report itself: identity, pool and a verdict.
test("Token Check: the NVDA report finds the real token and its pool", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/token-check");
  await page.getByLabel("Token contract address").fill("0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec");
  await page.getByRole("button", { name: "Check token" }).click();
  await expect(page).toHaveURL(/token-check\/0x/i);
  await expect(page.getByRole("heading", { level: 1, name: /NVDA/ })).toBeVisible({ timeout: 200_000 });
  await expect(page.getByText(/^(ALLOW|WARN|DENY)$/).first()).toBeVisible();
  await expect(page.getByText(/Uniswap v3/).first()).toBeVisible();
  await expect(page.getByText("This is the real NVDA.")).toBeVisible();
});
