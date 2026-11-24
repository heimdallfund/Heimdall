import type { Metadata } from "next";
import Link from "next/link";
import { H1, H2, Code, Table, C } from "@/components/docs/Docs";

export const metadata: Metadata = { title: "Wallet Check", description: "See every live approval of a wallet, ranked by risk, and revoke the dangerous ones." };

export default function Page() {
  return (
    <>
      <H1 lead={<>Wallet Check finds every live token approval of a Robinhood Chain wallet. It ranks each one by risk, shows how many dollars it exposes, and lets the owner revoke it. Checking is read-only and works for any address; only revoking sends a transaction.</>}>Wallet Check</H1>
      <H2 id="what-it-reads">What it reads</H2>
      <ul className="list-disc space-y-2 pl-5">
        <li>ERC-20 approvals (<C>{"approve"}</C>, <C>{"permit"}</C>)</li>
        <li>Permit2 allowances (expired ones are ignored)</li>
        <li>Operator approvals (<C>{"setApprovalForAll"}</C>)</li>
      </ul>
      <p>Each one is re-read live from the chain, so revoked approvals never show up.</p>
      <H2 id="risk-levels">Risk levels</H2>
      <Table head={["Level", "When"]} rows={[
        [<>Danger</>, <>The spender is a plain wallet, is on the Heimdall blocklist, or Shield has been denying transactions to it</>],
        [<>Review</>, <>An unlimited approval or operator approval to a contract Heimdall does not recognise</>],
        [<>OK</>, <>A known protocol contract (Uniswap routers, Permit2) or a limited allowance</>],
      ]} />
      <p><strong>Value at risk</strong> is the smaller of the allowance and the wallet&apos;s balance, priced with Chainlink feeds (USDG at $1).</p>
      <H2 id="suspicious-tokens">Suspicious tokens</H2>
      <p>Wallet Check also looks at the tokens the wallet holds, because the token itself can be the trap. Each one is checked against the blocklist and for a stolen ticker (a fake NVDA or USDG), and up to five unknown tokens get a full <Link className="text-brand" href="/token-check">Token Check</Link>: a token that cannot be sold, can vanish from the wallet, or can be pulled out by its owner is flagged. They are listed in <C>{"tokens"}</C>, each with a <C>{"code"}</C> (<C>{"FAKE_TOKEN"}</C>, <C>{"BLOCKLISTED_TOKEN"}</C>, <C>{"HONEYPOT"}</C>, <C>{"VANISHING_TOKEN"}</C>, <C>{"ALLOWANCE_BYPASS"}</C>, …). Do not swap, approve or send a flagged token.</p>
      <H2 id="api">API</H2>
      <Code lang="bash">{"curl https://api.heimdall.fund/v1/wallet/0xYourWallet"}</Code>
      <p>Large histories are read in steps. While <C>{"complete"}</C> is <C>{"false"}</C>, call again (add <C>{"?refresh=1"}</C>) and <C>{"progress"}</C> climbs to 100.</p>
      <H2 id="wallet-watch">Wallet Watch</H2>
      <p>Turn on <strong>Watch this wallet</strong> on a report and the browser shows a notification when a new risky approval appears (Danger or Review), including one to a spender that joins the blocklist later. Heimdall re-checks watched wallets every 15 minutes; the first check only records what is already there. Developers can get the same alerts on their server: see <Link className="text-brand" href="/docs/webhooks">Webhooks</Link>.</p>
      <ul className="list-disc space-y-2 pl-5">
        <li>Up to 5 wallets per browser. <strong>Stop watching</strong> removes the subscription.</li>
        <li>It uses standard web push: no account, no email. Heimdall stores the browser&apos;s push address and the wallet addresses, nothing else.</li>
        <li>It does not see outgoing transfers or signatures, only approvals.</li>
      </ul>
      <H2 id="revoking">Revoking</H2>
      <Table head={["Approval", "Transaction"]} rows={[
        [<>ERC-20</>, <><C>{"approve(spender, 0)"}</C> on the token</>],
        [<>Operator</>, <><C>{"setApprovalForAll(operator, false)"}</C> on the collection</>],
        [<>Permit2</>, <><C>{"lockdown([(token, spender)])"}</C> on Permit2</>],
      ]} />
      <p>Each risky approval you revoke earns 50 <Link className="text-brand" href="/docs/points">Guardian Points</Link>, up to 5 a day and 25 a season.</p>
    </>
  );
}
