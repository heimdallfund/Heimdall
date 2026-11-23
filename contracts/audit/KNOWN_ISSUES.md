# Known issues, accepted risks and open questions

Please don't report these again unless you can show more impact than described here.

## From internal review 1 (vault, signals, factory, guard)

All Critical, High and Medium findings are fixed, with regression tests. Accepted or mitigated:

- **M-06 (mitigated):** deposit and withdraw at oracle NAV allow oracle-latency arbitrage. Bounded by a 10,000 USDG per-vault deposit cap at launch. There is no sequencer-uptime feed on Robinhood Chain yet.
- **L-02 (accepted):** a performance fee skipped while a feed is stale is collected at the next fresh harvest.
- **L-04 (documented):** a payer's Signals balance is shared across signals; providers should check `available` and redeem often.
- **I-01, I-02, I-03, I-06:** informational, accepted.

## From internal review 2 (Pay, staking, splitter, stock feed)

All findings fixed except:

- **L-05 (accepted):** one paused or stale stock with a non-zero balance stops USDG deposits, withdrawals and trades vault-wide. By design a vault never prices with a bad oracle; `redeemInKind` keeps exits open.
- **I-01 (accepted):** anyone can refund an expired Open job.
- **I-06, I-07 (accepted):** fee-on-transfer tokens unsupported, unbounded `jobsOf*` view arrays, arbiter collusion bypassing the protocol fee, cached feed decimals.

## A. HeimdallAutoInvest (internal review, 2026-11-23)

Not covered by either review above. Findings from a read of the contract and Slither:

| ID | Severity | Issue | Status |
| --- | --- | --- | --- |
| A-01 | Low | The fee was read at execution time, so the owner could raise it (up to 1%) for plans that already exist | **Fixed:** the fee is stored on the plan at creation |
| A-02 | Low | The fee was pushed to `feeRecipient` on every buy, so a frozen recipient would block every plan | **Fixed:** fees accrue in the contract; `sweepFees()` (anyone) sends them on |
| A-03 | Info | The keeper picks the moment and can sandwich a buy down to the owner's bound (max 5% from the oracle) | By design; the app defaults the bound to 1% |
| A-04 | Info | Slither `arbitrary-send-erc20`: `execute` pulls from `p.owner` and can be called by anyone | By design: only on the owner's own plan, only `amountPerBuy`, only when due |
| A-05 | Info | Plans on 24/5 feeds (AAPL, MSFT, AMZN) skip weekends; the next buy runs when the feed is fresh, without catch-up | By design |

## From internal review 3 (all contracts, invariant testing)

Both findings are fixed with regression tests (see `SECURITY_REVIEW_3.md`): R3-01, the production build put the deployer over the EIP-170 size limit; R3-02, ERC-4626 views ignored a pending performance fee.

## From internal review 4 (Risk Oracle, Guard module, x402, Passport)

All three findings are fixed with regression tests (see `SECURITY_REVIEW_4.md`): R4-01, a limited token could be moved through calls the guard did not count; R4-02, one x402 payment could pay for many Shield calls; R4-03, the monitor re-sent pinned oracle entries.

| ID | Severity | Issue | Status |
| --- | --- | --- | --- |
| R-01 | Info | The Risk Oracle is only as good as Shield's list: a new drainer is flagged after Shield learns about it and the next sync (every 10 minutes by default) | By design; the Safe can `pin` an entry at once |
| R-02 | Info | A compromised reporter key can mark any unpinned address as blocked (denial of service for integrators that fail closed) or clear entries | Accepted: the Safe replaces the reporter with `setReporter` and pins what matters; integrators choose `failClosed` |
| R-03 | Info | Guard limits use fixed 24 h windows, so up to twice the daily limit can move around a window boundary | By design, documented; set the limit with that in mind |
| R-04 | Info | Unlisted tokens are not limited unless the Safe turns on `strictTokens` | By design; the setup builder turns it on by default |

## Open questions for the auditor

- **Q-1: corporate actions (resolved 2026-11-23).** Robinhood's Chainlink feeds return the price of one *token*: the share price already multiplied by `uiMultiplier()` (ERC-8056). Our contracts use `balance × feed price` and never apply the multiplier again, which is correct. For a split, Robinhood pauses the token's oracle first; `HeimdallStockFeed` reports stale while `oraclePaused()` is true. New guard: it also reports stale when the token's `effectiveAt()` is past and later than the feed's `updatedAt`, so a price computed with the old multiplier is never used. The monitor alerts on scheduled multiplier changes and pauses. Please still check the guard and the window between activation and the next feed update.
- **Q-2: sequencer downtime.** Robinhood Chain has no L2 sequencer-uptime feed today (confirmed November 2026). Our staleness bounds (90,000 s for stock feeds) are the only protection.
- **Q-3: Shield signer compromise.** We believe a stolen signer key is bounded by the allowlist and the loss caps. The vault invariant test (V-11) supports this: with every receipt granted and a manager routing swap output to itself, extraction stayed within the daily loss limit across 512 × 200 random actions. Please try to break it with paths the handler does not model (other allowlisted selectors, multi-hop routes, fee-on-transfer tokens).
