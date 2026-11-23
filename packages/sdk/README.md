# @heimdall/sdk

TypeScript SDK for Heimdall on Robinhood Chain.

```ts
import { HeimdallShield, guardedSend, executeThroughVault, signVoucher } from "@heimdall/sdk";

const shield = new HeimdallShield({ apiKey: process.env.HEIMDALL_API_KEY });

// 1. Check before signing (throws HeimdallDenied unless ALLOW)
await guardedSend(wallet, { to, data, value }, { shield, policy: { strict: true } });

// 2. Manager agent trading a Heimdall Vault: Shield receipt → vault.execute
await executeThroughVault(wallet, { vault, target: router, data: swapCalldata }, { shield });

// 3. Pay a signal per call with a gasless voucher (send it in the x-heimdall-voucher header)
const v = await signVoucher(wallet, { chainId: 4663, signals, signalId: 3n, cumulativeAmount: 150_000n });
```

Providers verify incoming vouchers with `verifyVoucher` and redeem them onchain with `HeimdallSignals.redeem`.
