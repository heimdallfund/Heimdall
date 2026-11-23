---
description: A Safe module that lets an AI agent spend from a Safe only with a Shield receipt and within daily limits the owners set. The agent is never an owner.
---

# Guard for Safe

Heimdall Guard is a Safe module. Once a Safe enables it, an AI agent can spend from the Safe, but only:

- with a fresh Shield ALLOW receipt for that exact call, issued to the Safe,
- within 24-hour limits for ETH and for each token the owners list,
- never on the Safe itself or on the module, and always as a plain CALL (never DELEGATECALL).

The agent never becomes an owner. The owners can pause it, change its limits, let it expire or remove it at any time with a normal Safe transaction. It is tested against Safe 1.4.1, the official deployment on Robinhood Chain.

## Set it up

From the Safe, run these transactions (the setup page on heimdall.fund/guard builds the Transaction Builder file for you):

| Call | What it does |
| --- | --- |
| `safe.enableModule(module)` | Lets the module act for this Safe |
| `module.setPolicy(ethPerDay, strictTokens, strictTargets)` | ETH budget per 24 h; strict modes |
| `module.setTokenLimit(token, perDay, true)` | A 24 h budget for a token (raw units) |
| `module.setTarget(contract, true)` | Allow a contract when `strictTargets` is on |
| `module.setAgent(agent, true, expiresAt)` | The agent's wallet, with an optional expiry |

With the SDK:

```ts
import { guardSetupCalls, safeBatch } from "@heimdall/sdk";

const calls = guardSetupCalls(safe, {
  module: GUARD_MODULE,
  agent: agentWallet,
  tokens: [{ token: USDG, perDay: 100_000_000n }], // 100 USDG a day
  strictTokens: true,
});
// import this file in app.safe.global → Transaction Builder
writeFileSync("setup.json", JSON.stringify(safeBatch(4663, safe, calls)));
```

## Run the agent through it

```ts
import { executeThroughGuard, guardRemaining, HeimdallShield } from "@heimdall/sdk";

await executeThroughGuard(agentWallet, { module: GUARD_MODULE, safe, to: USDG, data }, { shield: new HeimdallShield() });
const left = await guardRemaining(publicClient, GUARD_MODULE, safe, USDG); // budget left today
```

`executeThroughGuard` asks Shield about the call as the Safe, and throws `HeimdallDenied` on WARN or DENY, so nothing reaches the chain.

## What the limits count

- **ETH:** the `value` of every call.
- **A limited token:** `transfer`, `approve`, `increaseAllowance`, and `transferFrom` out of the Safe. An approval counts like a transfer, so an unlimited approval of a limited token is impossible. `approve(spender, 0)` and `decreaseAllowance` are always allowed.
- **Anything else on a limited token** (for example `transferAndCall` or `burn`) is refused, so a token can never move uncounted.
- **Strict tokens:** token movements of tokens without a limit are refused. Recommended.
- **Strict targets:** only listed contracts (and limited tokens) can be called.

Windows are fixed 24-hour windows that start with the first spend after the last one ended.

## Who can do what

| Who | Can |
| --- | --- |
| Safe owners | Everything: agents, limits, targets, pause, their own Shield signer, removing the module |
| Agent | `execute` within the rules above. Nothing else |
| Heimdall multisig | Choose the default Shield signers. Nothing in any Safe |
| A Safe | Pin its own receipt signer with `setSignerOverride` (for a self-hosted Shield) |

## Security notes

- If the agent key leaks, a thief still needs a Shield ALLOW receipt for each call and can move at most one day of budget.
- If the Shield signer also leaks, the limits still hold: they live in the module. In stateful tests, a hostile agent with every receipt granted never moved more than the budget.
- The module is reviewed in Heimdall's internal security review 4. It has not had an external audit yet.

The module address is published at launch on the [Contracts](../build/contracts.md) page.
