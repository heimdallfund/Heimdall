---
description: Onchain risk data for Robinhood Chain that any contract can read in one call. Drainers, phishing contracts, exploiters and honeypots, kept current by Heimdall.
---

# Risk Oracle

The Heimdall Risk Oracle is a contract on Robinhood Chain that holds a risk level for known-bad addresses: drainers, phishing contracts, exploiters and honeypot tokens. Any contract reads it with one view call, for free.

## Levels and flags

| Level | Name | Meaning |
| --- | --- | --- |
| 0 | none | No data. Not a guarantee: check the transaction itself with Shield. |
| 1 | low | Seen in a risky pattern. |
| 2 | warn | Shield denied 5 or more transactions to it this week. Review before trusting. |
| 3 | blocked | Drainer, phishing, exploiter or honeypot, on Heimdall's blocklist. Refuse. |

Flags are bits, and an entry can carry several: `DRAINER` (1), `PHISHING` (2), `HONEYPOT` (4), `MALICIOUS_CONTRACT` (8), `SCAM_TOKEN` (16), `EXPLOITER` (32), `COMMUNITY` (64, confirmed from a community report), `SHIELD_DENIED` (128).

## Read it from a contract

Copy `IHeimdallRisk.sol` and `HeimdallRiskAware.sol` from the Heimdall contracts (MIT), then add the modifier to any function:

```solidity
contract MyLaunchpad is HeimdallRiskAware {
    constructor(IHeimdallRisk oracle) HeimdallRiskAware(oracle, false) {}

    function buy(address to) external notBlocked(msg.sender) notBlocked(to) {
        // blocked addresses never get here
    }
}
```

`HeimdallRiskAware` reads the oracle with a gas-capped static call and never reverts on its own. The second constructor argument picks what happens if the oracle cannot be read: `false` lets the call through (most apps), `true` blocks it (for flows where an unchecked address is worse than a pause).

Direct reads:

```solidity
IHeimdallRisk(oracle).isBlocked(recipient);            // bool
IHeimdallRisk(oracle).riskOf(addr);                    // (uint8 level, uint32 flags, uint64 updatedAt)
IHeimdallRisk(oracle).anyBlocked(addresses);           // one call for a whole route
```

## Read it offchain

```ts
import { readRisk, HeimdallShield } from "@heimdall/sdk";

const onchain = await readRisk(publicClient, ORACLE, "0x…"); // { level, levelName, flags, blocked }
const full = await new HeimdallShield().risk("0x…");          // plus the reason and what Shield knows
```

The HTTP API answers without a key: `GET /v1/risk/:address` for one address, `GET /v1/risk` for the whole list. The MCP server and agent-kit have the same lookup as the `heimdall_risk` tool.

## How it stays current

- Shield's risk list is built from Heimdall's curated blocklist, confirmed community reports, and addresses Shield keeps denying.
- Every 10 minutes the monitor compares that list with the oracle and writes the differences in batches of up to 200: new entries, changed flags and cleared entries. Each write is a `RiskSet` event.
- Only reporters approved by the Heimdall multisig can write, and only levels and flags.

## Mistakes and appeals

The multisig can pin an entry: set its level and lock it so reporters cannot change it. A false positive is cleared by pinning the address at level 0. Report one to security@heimdall.fund with the address and why it is safe.

## Address

The oracle address is published at launch on the [Contracts](../build/contracts.md) page and on heimdall.fund/oracle.
