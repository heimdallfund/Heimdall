# Threat model

## Actors

| Actor | Trusted for | Must never be able to |
| --- | --- | --- |
| **Owner (Safe multisig)** | Configuration: feeds, allowlisted calls and spenders, caps, fees (within hard caps), Shield signer, pausing | Take depositor funds, escrow or user USDG directly. Raise a fee above its hard cap. Change the fee of an existing Pay job or Auto-Invest plan |
| **Shield signer** (off-chain key, AWS KMS in production) | Signing ALLOW receipts for vault calls after simulation | Make a vault execute a call outside the owner's allowlist, or beyond the loss caps |
| **Vault manager** (an AI agent's wallet) | Choosing trades | Withdraw depositor funds, grant allowances to a non-allowlisted spender, call any (target, selector) pair the owner has not allowlisted, lose more than the per-trade and 24 h caps |
| **Depositor** | Nothing | Take more than their pro-rata share; push a performance fee onto others by donating |
| **Pay client / provider / arbiter** | Client: funding and accepting work. Provider: delivering. Arbiter: deciding a dispute | Client: take back escrow after accepting it. Provider: be paid without the client releasing, the review window lapsing, or a ruling. Arbiter: pay out more than the escrow, or hold it beyond 14 days |
| **Keeper** (anyone) | Calling `execute` on due Auto-Invest plans, `distribute` on the splitter, `sweepFees` | Change the amount, the token, the recipient, the timing (beyond waiting) or accept a price worse than the owner's bound |
| **Signals payer / provider** | Payer: signing cumulative vouchers. Provider: redeeming them | Provider: redeem beyond the signed cumulative amount or the payer's available balance. Payer: escape a voucher already signed by racing a withdrawal |
| **USDG issuer (Paxos)** | Outside our control: can pause USDG or freeze any address | Freezing one party must not lock funds that belong to other parties |
| **Chainlink / token oracle** | Prices, and a `paused` flag on each stock token | A stale, paused or off-peg price must never be used to value or trade |

## Assets

1. USDG and stock tokens held by vaults (depositor money).
2. USDG in Pay escrow.
3. USDG that users approved to Auto-Invest (sitting in their own wallets).
4. Payer balances in Signals.
5. Staking principal ($HEIM) and USDG rewards.

## Attacks we care about most

| # | Attack | Main defence | Checked by |
| --- | --- | --- | --- |
| T-1 | Manager drains a vault through an approval (`approve`, `increaseApproval`, Permit2) or an arbitrary call | Owner allowlist of (target, selector); on tokens only `approve` to an allowlisted spender, or 0 | `testFuzz_tokenCallsCannotGrantAllowance`, `testFuzz_unknownTargetsRevert`, `test/poc/vault.poc.test.ts` |
| T-2 | Manager bleeds NAV with many bad-price trades | Per-trade loss cap plus a rolling 24 h loss budget, both valued at the oracle | `vault.test.ts`, PoC H-01 |
| T-3 | Replay or reuse of a Shield receipt | Receipt binds vault, target, calldata hash, value, expiry and a `checkId` consumed once | `vault.test.ts` |
| T-4 | Donation or first-depositor tricks to charge fees or steal rounding | High-water mark reset at zero supply, ERC-4626 virtual shares | `testFuzz_noFeeOnDonation`, `testFuzz_roundTripNoProfit` |
| T-5 | Exit blocked by a dead feed or a halted token | `redeemInKind` / `redeemInKindExcept` need no price | `testFuzz_inKindProRata`, PoC M-01 |
| T-6 | Escrow stuck or double-paid in Pay | Single state machine per job; 14-day dispute timeout; pull fallback for frozen addresses | `testFuzz_conservation`, `test/poc2/PayPoc.t.sol` |
| T-7 | Keeper or MEV makes Auto-Invest buy at a bad price | `minOut` from the oracle and the owner's bound (max 5%); no buy while the oracle is stale or paused | `testFuzz_boundedBuy`, `testFuzz_staleOracleNeverBuys`, `autoinvest.test.ts` |
| T-8 | Reward theft or insolvency in staking | Synthetix accounting; only the splitter can notify rewards | `testFuzz_solvent`, `test/poc2/StakingSplitterPoc.t.sol` |
| T-9 | Provider over-redeems Signals vouchers | Cumulative vouchers; `available = balance − pending withdrawal` | `testFuzz_vouchersNeverOverpay`, `test/poc/signals.poc.test.ts` |
| T-10 | Stale, paused or off-peg prices | `HeimdallStockFeed` returns stale (updatedAt 0) on oracle pause, stale quote or USDG outside 0.90–1.10; consumers treat stale as unavailable | `stockfeed.test.ts`, `test/poc2/stockfeed-vault.poc.test.ts` |

## Trust assumptions

- The Safe signers are honest and careful. A malicious owner could allowlist a draining call on a vault (bounded by the loss caps only for value drops the oracle can see), point a feed at a bad oracle, or replace the Shield signer. A timelock is planned before vault deposit caps are raised.
- The Shield signer key is held in a KMS and only signs after a simulation. A compromised signer is still bounded by the allowlist and loss caps.
- Chainlink feeds on Robinhood Chain are correct when fresh. There is no sequencer-uptime feed on the chain yet (see KNOWN_ISSUES).
