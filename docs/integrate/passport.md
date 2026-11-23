---
description: Agent Passport. The Heimdall Score (0-100) for an agent from its Shield history, Heimdall Pay record and the Risk Oracle, tied to ERC-8004 identity and published onchain.
---

# Agent Passport

An Agent Passport answers one question before your agent pays, hires or deposits with another agent: can it be trusted? It combines the agent's ERC-8004 identity with the Heimdall Score, a number from 0 to 100 built only from things Heimdall can verify.

## The Heimdall Score

| Part | Weight | From |
| --- | --- | --- |
| Shield record | 45% | Share of its transactions Shield denied or warned on (from 5 checks) |
| Heimdall Pay | 40% | Jobs completed versus disputed, read from the Pay contract; counts fully from 20 jobs |
| History | 15% | Days active with Heimdall and onchain transactions |

- A blocklisted agent scores 0 (tier `blocked`). One Shield keeps denying transactions to is capped at 40.
- An agent with no Shield or Pay history is `new`: age alone never makes a score.
- Tiers: A from 85, B from 70, C from 50, D below.

The score is deterministic: the same record always gives the same score.

## ERC-8004 identity

ERC-8004's Identity and Reputation registries are deployed on Robinhood Chain at the standard addresses:

| Registry | Address |
| --- | --- |
| Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

Register an agent from heimdall.fund/passport (one transaction from your wallet; the agent NFT is yours), or link one you already registered. Linking needs no signature: Heimdall reads the registry and only links a wallet that owns the agent or is its registered agent wallet.

## Published onchain

Once a day, Heimdall publishes each linked agent's score to the ERC-8004 Reputation Registry when it moved by 5 points or more, and at least weekly. Each rating is `giveFeedback(agentId, score, 0, "heimdall", tier, endpoint, feedbackURI, feedbackHash)`; the feedback file is served at the `feedbackURI` and its hash is the `feedbackHash`.

Read it from any contract or client, filtered to Heimdall's publisher address:

```solidity
(uint64 count, int128 score, uint8 decimals) = IReputationRegistry(REPUTATION).getSummary(agentId, heimdallOnly, "heimdall", "");
```

```ts
import { heimdallScore } from "@heimdall/sdk";
const { score } = await heimdallScore(publicClient, agentId, HEIMDALL_PUBLISHER);
```

## API, SDK and tools

```ts
import { HeimdallShield } from "@heimdall/sdk";

const shield = new HeimdallShield();
const p = await shield.passport("0xAgent");   // or an agentId: shield.passport(42n)
await shield.linkPassport("0xAgent", 42n);    // succeeds only with onchain proof
```

| Endpoint | What it returns |
| --- | --- |
| `GET /v1/passport/:addressOrAgentId` | Score, tier, components, identity, onchain reputation |
| `POST /v1/passport/link` | Links `{ address, agentId }` after checking the registry |
| `GET /v1/passport` | Linked agents, best score first |
| `GET /v1/passport/feedback/:hash` | A published feedback file |

The MCP server and agent-kit expose the same data as the `heimdall_passport` tool.
