import { getAddress, type Address, type PublicClient } from "viem";
import { isBlocklisted } from "./blocklist.js";
import { inList, type Policy } from "./policy.js";
import type { Finding } from "./types.js";

/**
 * EIP-7702: an authorization [chain_id, address, nonce] signed by a wallet makes that wallet run the code at
 * `address`. Whoever wrote that code controls every asset in the wallet, so it is the strongest signature a wallet
 * can give, and the newest drainer trick. Heimdall allows only wallet implementations it knows (deployed at the
 * same address on every chain, checked on Robinhood Chain on 2026-11-24) or ones the agent's policy trusts.
 */
export const KNOWN_DELEGATES: Record<string, string> = {
  "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b": "MetaMask EIP7702StatelessDeleGator",
  "0x4cd241e8d1510e30b2076397afc7508ae59c66c9": "Simple7702Account (ERC-4337 v0.8)",
  "0x000000009b1d0af20d8c6d0a44e162d11f9b8f00": "Uniswap Calibur",
  "0x7702cb554e6bfb442cb743a7df23154544a7176c": "Coinbase EIP7702Proxy",
  "0x5a7fc11397e9a8ad41bf10bf13f22b0a63f96f6d": "Ambire 7702 account",
};

export interface Authorization { chainId: number | string; address: string; nonce?: number | string }

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export async function judgeAuthorization(auth: Authorization, chainId: number, policy: Policy, client: PublicClient): Promise<{ findings: Finding[]; summary: string }> {
  const F: Finding[] = [];
  const add = (code: string, severity: Finding["severity"], message: string) => F.push({ code, severity, message });
  const delegate = getAddress(auth.address) as Address;
  const authChain = Number(auth.chainId);

  if (/^0x0{40}$/i.test(delegate)) {
    add("AUTH_REVOKE", "info", "Clears the wallet's EIP-7702 delegation: it becomes a plain wallet again.");
    return { findings: F, summary: "EIP-7702: removes the delegation" };
  }
  const name = KNOWN_DELEGATES[delegate.toLowerCase()];
  const summary = `EIP-7702: the wallet will run the code at ${name ? `${name} (${short(delegate)})` : short(delegate)}${authChain === 0 ? " on every chain" : ""}`;

  if (authChain === 0) add("AUTH_ALL_CHAINS", "deny", "The authorization has chain ID 0, so it is valid on every EVM chain, including ones where this address holds different code. Sign one for chain 4663 only.");
  else if (authChain !== chainId) add("WRONG_CHAIN", "deny", `The authorization is for chain ${authChain}, not ${chainId}.`);

  if (isBlocklisted(delegate)) { add("BLOCKLISTED_DELEGATE", "deny", `Delegates the wallet to ${short(delegate)}, a contract on the Heimdall blocklist: it would control every asset in the wallet.`); return { findings: F, summary }; }

  const code = await client.getCode({ address: delegate }).catch(() => undefined);
  if (!code || code === "0x") add("DELEGATE_NO_CODE", "deny", `There is no contract at ${short(delegate)} yet. Whoever deploys there later would control the wallet.`);
  else if (code.toLowerCase().startsWith("0xef0100")) add("DELEGATE_IS_WALLET", "deny", `${short(delegate)} is itself a delegated wallet, not a wallet implementation.`);
  else if (name) add("KNOWN_DELEGATE", "info", `${name} is a known smart-wallet implementation. The wallet keeps its key and gains its features.`);
  else if (inList(policy.trustedDelegates, delegate)) add("TRUSTED_DELEGATE", "info", `${short(delegate)} is trusted by this agent's policy.`);
  else add("UNKNOWN_DELEGATE", "deny", `Hands full control of the wallet to ${short(delegate)}, a contract Heimdall does not know. This is how EIP-7702 drainers work: the code can move every token in one call. Trust it in the policy (trustedDelegates) only if you wrote or audited it.`);
  return { findings: F, summary };
}
