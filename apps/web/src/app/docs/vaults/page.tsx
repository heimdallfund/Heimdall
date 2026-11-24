import type { Metadata } from "next";
import Link from "next/link";
import { Code, H1, H2, Table, Note, C } from "@/components/docs/Docs";

export const metadata: Metadata = { title: "Vaults", description: "Heimdall vaults: ERC-4626 on USDG, manager agents trade only with a Shield receipt, onchain size and loss limits, always-on in-kind exit." };

export default function Page() {
  return (
    <>
      <H1 lead="An ERC-4626 vault on USDG whose manager is an AI agent. The agent can trade; it can never take depositor money.">Vaults</H1>
      <H2 id="depositors">For depositors</H2>
      <ul className="list-disc space-y-2 pl-5">
        <li>Deposit USDG, receive vault shares. The share price is NAV ÷ shares, with stock tokens valued by price feeds.</li>
        <li><C>withdraw</C>/<C>redeem</C> pay USDG up to the vault&apos;s idle USDG. <C>redeemInKind</C> always works: it pays your share of every asset the vault holds, needs no price feed and works while the vault is paused. If a token is ever halted, <C>redeemInKindExcept</C> skips it.</li>
        <li>Fee: 15% of new profit above the high-water mark (10% to the manager, 5% to Heimdall), taken as newly minted shares. If the manager holds $HEIM, Heimdall&apos;s cut halves and the total is 12.5%. No management or withdrawal fee.</li>
        <li>Guarded launch: each vault starts with a 10,000 USDG deposit cap, raised by the Heimdall multisig as vaults build a record.</li>
      </ul>
      <H2 id="managers">For managers</H2>
      <p>Open a vault at <Link className="text-brand" href="/vaults/new">/vaults/new</Link> or call <C>createVault(name, symbol, maxTradeBps, maxLossBps)</C> on the factory. Your wallet becomes the manager. Caps: 25% of NAV per trade (2500 bps), 3% loss per trade (300 bps).</p>
      <p>To trade, ask Shield about the call <em>as the vault</em> (<C>from = vault</C>, <C>value = 0</C>), then pass the receipt to <C>execute</C>:</p>
      <Code lang="ts">{`import { executeThroughVault } from "@heimdallfund/sdk";

// approve the router once, then swap — each call needs its own ALLOW receipt
await executeThroughVault(manager, { vault, target: USDG, data: approveRouterCalldata }, { shield });
await executeThroughVault(manager, { vault, target: router, data: swapCalldata }, { shield });`}</Code>
      <H2 id="guard">What the vault enforces onchain</H2>
      <Table head={["Rule", "Detail"]} rows={[
        ["Shield receipt", "Signed by an approved Shield signer, verdict ALLOW, not expired, not used before, and for exactly this vault, target, calldata and value."],
        ["Allowlisted calls", "Only (router, function) pairs reviewed by the multisig, e.g. a swap function. Everything else reverts."],
        ["Tokens", "On USDG and tracked stock tokens only approve works: to an allowed spender, or 0 to revoke anyone."],
        ["Trade size", "Value leaving the vault in one call ≤ maxTradeBps of NAV."],
        ["Loss per trade", "NAV after the call ≥ NAV before × (1 − maxLossBps)."],
        ["Loss per day", "Trades can lose at most 5% of NAV in total per 24-hour window."],
        ["Prices", "Chainlink feeds per asset with a heartbeat; a stale or broken feed pauses valuation-dependent actions, never in-kind exits. The multisig can replace a feed. Vaults can hold up to 16 stock tokens: NVDA, TSLA and GOOGL (priced 24/7) and AMZN, AAPL, MSFT, META, COIN, QQQ, SPCX, GME, MU, CRCL, DELL, USO and SGOV (priced Monday to Friday). A vault that holds a weekday stock pauses deposits, NAV withdrawals and trades from Saturday 00:00 to Monday 01:00 UTC, like a closed market; in-kind exits keep working and a vault that does not hold one is never paused."],
        ["Re-entrancy", "Every state-changing entry point is non-reentrant."],
      ]} />
      <Note>The vault owner is the Heimdall multisig, never the manager. The owner can pause, update targets, spenders, assets and feeds, rotate the manager and the Shield signer, and set the deposit cap.</Note>
    </>
  );
}
