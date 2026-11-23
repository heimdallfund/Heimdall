import type { ReactNode } from "react";
import Link from "next/link";

/** Long-form guides for search: plain HTML pages with Article (and HowTo) structured data. */
export interface Guide {
  slug: string;
  title: string;
  description: string;
  /** ISO date of the last factual review. */
  updated: string;
  minutes: number;
  tag: string;
  /** For HowTo structured data: the numbered steps, in plain text. */
  steps?: string[];
  sources?: [string, string][];
  body: ReactNode;
}

const A = ({ href, children }: { href: string; children: ReactNode }) =>
  href.startsWith("/") ? <Link href={href}>{children}</Link> : <a href={href} target="_blank" rel="noopener">{children}</a>;
const C = ({ children }: { children: ReactNode }) => <code>{children}</code>;
const Pre = ({ children }: { children: string }) => <pre><code>{children}</code></pre>;

export const GUIDES: Guide[] = [
  {
    slug: "revoke-token-approvals-robinhood-chain",
    title: "How to revoke token approvals on Robinhood Chain",
    description: "Find every contract that can still move your USDG, stock tokens or any other token on Robinhood Chain, and revoke the risky ones in a few clicks.",
    updated: "2026-11-23",
    minutes: 5,
    tag: "Wallet safety",
    steps: [
      "Open Wallet Check and paste your wallet address. No wallet connection is needed to scan.",
      "Read the list: every approval is rated danger, review or ok, with the USD value the spender could take today.",
      "Connect the wallet that gave the approvals.",
      "Press Revoke next to each danger or review row and confirm the transaction in your wallet.",
      "Scan again to confirm the approvals are gone.",
    ],
    body: (
      <>
        <p>Every time you trade on a DEX, use a vault or try a new app, you sign an <strong>approval</strong>: permission for a contract to move a token out of your wallet. Approvals do not expire. Many apps ask for an unlimited amount, so a contract you used once can still move every USDG or stock token you hold months later. If that contract is ever exploited, or was a drainer from the start, the approval is the door.</p>
        <p>Revoking means setting that permission back to zero. It costs a small amount of ETH for gas and takes a few seconds per approval.</p>

        <h2 id="kinds">The three kinds of approval</h2>
        <ul>
          <li><strong>ERC-20 approvals</strong> (<C>approve</C>): a spender may move up to an amount of one token. &quot;Unlimited&quot; means the largest possible number.</li>
          <li><strong>Permit2 allowances</strong>: many swap apps route approvals through the Permit2 contract (<C>0x0000…78BA3</C>). You approve Permit2 once, then sign gasless messages that give each app an allowance inside Permit2. Those allowances live in Permit2, not in the token, so a plain token check misses them.</li>
          <li><strong>NFT operator approvals</strong> (<C>setApprovalForAll</C>): an operator may move every item of a collection.</li>
        </ul>

        <h2 id="steps">Revoke them in five steps</h2>
        <ol>
          <li>Open <A href="/check">Wallet Check</A> and paste your address. Scanning is read-only: no connection, no signature.</li>
          <li>Read the list. <strong>Danger</strong> means an unlimited approval to an unknown, unverified or blocklisted spender, or to a plain wallet. <strong>Review</strong> means something worth a second look, such as an unlimited approval to a contract you may no longer use. Each row shows the USD value the spender could take right now.</li>
          <li>Connect the wallet that gave the approvals.</li>
          <li>Press <strong>Revoke</strong> on each danger or review row. ERC-20 approvals are set to 0, NFT operators are switched off, and Permit2 allowances are revoked with Permit2&apos;s <C>lockdown</C>. Confirm each transaction in your wallet.</li>
          <li>Scan again. The row disappears once the revoke is mined.</li>
        </ol>
        <p>Each risky approval you revoke also earns 50 <A href="/points">Guardian Points</A>.</p>

        <h2 id="manual">Without Heimdall</h2>
        <p>You can revoke by hand on the block explorer: open the token contract on <A href="https://robinhoodchain.blockscout.com">Blockscout</A>, go to <em>Write contract</em>, connect your wallet and call <C>approve(spender, 0)</C>. You need to know the spender address, which is the hard part: that is what a scan finds for you.</p>

        <h2 id="habits">Habits that keep the list short</h2>
        <ul>
          <li>Approve the exact amount you are about to use when the app allows it.</li>
          <li>Read signature requests as carefully as transactions. A &quot;Permit&quot; or &quot;PermitSingle&quot; message is an approval, even though it costs no gas.</li>
          <li>Scan after trying any new app, and once a month anyway.</li>
          <li>Keep long-term holdings in a wallet that never connects to new apps.</li>
        </ul>
      </>
    ),
  },
  {
    slug: "stop-ai-agent-signing-drainer",
    title: "How to stop an AI agent from signing a drainer",
    description: "An onchain agent with a hot wallet will eventually be shown a malicious transaction or permit. Here is how to make sure it never signs one.",
    updated: "2026-11-23",
    minutes: 7,
    tag: "AI agents",
    body: (
      <>
        <p>An AI agent that trades, pays or rebalances needs a wallet it can sign with. That makes it a target. It reads web pages, API responses and messages from other agents, and any of them can carry a prompt injection or simply a bad address. A model that is 99% careful still signs the one transaction that empties the wallet.</p>
        <p>The fix is the same as for people: never sign what you have not simulated, and let a rule, not the model, have the last word.</p>

        <h2 id="threats">What actually drains agent wallets</h2>
        <ul>
          <li><strong>Unlimited approvals</strong> to a contract the attacker controls, often hidden inside a &quot;swap&quot; or &quot;claim&quot;.</li>
          <li><strong>Permit and Permit2 signatures.</strong> They cost no gas and never appear as a transaction, so a check that only looks at transactions misses them.</li>
          <li><strong>Transfers to a lookalike address</strong> taken from a poisoned message or page.</li>
          <li><strong>Honeypot tokens</strong> the agent can buy but never sell.</li>
          <li><strong>Reverting or oversized transactions</strong> that waste funds or break the agent&apos;s own limits.</li>
        </ul>

        <h2 id="layers">Five layers, cheapest first</h2>
        <ol>
          <li><strong>A separate wallet</strong> holding only what the agent needs this week.</li>
          <li><strong>Simulate every transaction</strong> on the latest block before signing, and look at what actually moves: tokens out, approvals given, the revert reason.</li>
          <li><strong>Check signatures too</strong>, with the same care: Permit, Permit2, Seaport orders and <C>personal_sign</C>.</li>
          <li><strong>A policy outside the model</strong>: spending caps per transaction, allowed targets, trusted spenders, no unlimited approvals. The model cannot talk its way past code.</li>
          <li><strong>A hard rule</strong>: never sign on DENY, and treat a failed check as DENY.</li>
        </ol>

        <h2 id="mcp">With Heimdall Shield over MCP</h2>
        <p>Claude, Cursor and any MCP agent get the checks as tools. Add the server to the client&apos;s config:</p>
        <Pre>{`{
  "mcpServers": {
    "heimdall": { "command": "npx", "args": ["-y", "@heimdall/mcp"] }
  }
}`}</Pre>
        <p>The server tells the model to check every transaction and signature before signing and never to sign on DENY. See <A href="/docs/mcp">MCP server</A> for every client.</p>

        <h2 id="code">In your own agent code</h2>
        <p>With the Vercel AI SDK, LangChain or ElizaOS, <A href="/docs/frameworks">@heimdall/agent-kit</A> adds the checks as native tools. Give it the wallet and the agent gets <C>heimdall_safe_send</C>, which only sends what Shield allows:</p>
        <Pre>{`import { generateText } from "ai";
import { heimdallAiTools } from "@heimdall/agent-kit/ai-sdk";

const { text } = await generateText({
  model,
  tools: heimdallAiTools({
    wallet,
    policy: {
      maxTokenOut: { "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168": "500000000" }, // at most 500 USDG per transaction
      denyUnlimitedApprovals: true,
    },
  }),
  prompt: "Swap 50 USDG for NVDA",
});`}</Pre>
        <p>Or call it directly before you send anything:</p>
        <Pre>{`import { HeimdallShield, guardedSend } from "@heimdall/sdk";

const shield = new HeimdallShield({ apiKey: process.env.HEIMDALL_API_KEY });
const { hash } = await guardedSend(wallet, { to, data, value }, { shield }); // throws HeimdallDenied unless ALLOW`}</Pre>

        <h2 id="checklist">Checklist</h2>
        <ul>
          <li>The agent&apos;s wallet holds only working funds.</li>
          <li>Every transaction and every signature request is checked before signing.</li>
          <li>Spending caps and allowed targets live in code, not in the prompt.</li>
          <li>DENY, or no answer, means no signature.</li>
          <li>You <A href="/check">scan the agent&apos;s wallet</A> for leftover approvals every week.</li>
        </ul>
      </>
    ),
  },
  {
    slug: "robinhood-chain-stock-token-prices",
    title: "How stock token prices work on Robinhood Chain",
    description: "Why a Robinhood Chain stock token is not priced exactly like the share, what the uiMultiplier is, and how splits and dividends show up onchain.",
    updated: "2026-11-23",
    minutes: 6,
    tag: "Stock tokens",
    sources: [
      ["Robinhood Chain docs: Oracles & Price Feeds", "https://docs.robinhood.com/chain/oracles-and-price-feeds"],
      ["Robinhood Chain docs: Building with Stock Tokens", "https://docs.robinhood.com/chain/building-with-stock-tokens"],
      ["Chainlink docs: Robinhood Tokenized Equities", "https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood"],
    ],
    body: (
      <>
        <p>Each stock on Robinhood Chain is its own ERC-20 token, one contract per ticker, with its own Chainlink price feed. The feed returns the price of <strong>one token</strong>, and that is not always the price of one share.</p>

        <h2 id="multiplier">The multiplier</h2>
        <p>Every stock token exposes <C>uiMultiplier()</C> (ERC-8056, the Scaled UI Amount extension): how many shares one token represents, scaled by 10<sup>18</sup>. It starts at 1.0. When a company pays a dividend, the dividend is reinvested and the multiplier rises a little, so one token now stands for slightly more than one share. A split raises it in one step: after a 4-for-1 split, one token represents four shares.</p>
        <p>Balances never rebase. Your token count stays the same; what each token is worth changes. On 23 November 2026 (UTC), for example, NVDA&apos;s multiplier read about 1.0008 and AAPL&apos;s about 1.0011 onchain, after their reinvested dividends.</p>

        <h2 id="price">What the price feed returns</h2>
        <p>The Chainlink feed already includes the multiplier: <strong>token price = share price × multiplier</strong>. Value a holding as <C>balance × feed price</C> and nothing else. Multiplying by the multiplier again overstates it.</p>
        <p>Some feeds run 24/7 and some only during market hours (24/5). Off hours, a 24/5 feed holds its last price and publishes no heartbeat, so a staleness check on <C>updatedAt</C> needs to allow for weekends, or the asset should be left out of anything that must price it on a Sunday.</p>

        <h2 id="splits">What happens during a split</h2>
        <ol>
          <li>Robinhood pauses the token&apos;s oracle (<C>oraclePaused()</C> turns true). The feed freezes at its last good price.</li>
          <li>The new multiplier is scheduled: <C>newUIMultiplier()</C> holds it, and <C>effectiveAt()</C> says when it takes over.</li>
          <li>After the split, Robinhood checks the market price and the multiplier, then unpauses. The feed resumes with the new multiplier, so the token price is continuous even though the share price fell.</li>
        </ol>
        <p>The scheduled time is not the moment prices resume: unpausing is a separate, manual step. Until then the feed shows the frozen price.</p>

        <h2 id="builders">If you build on stock tokens</h2>
        <ul>
          <li>Read <C>latestRoundData()</C> and reject answers that are zero, negative or older than your staleness bound.</li>
          <li>Treat <C>oraclePaused() == true</C> as &quot;no price&quot;, and fail closed if you cannot read it.</li>
          <li>Treat a price published before the latest <C>effectiveAt()</C> as stale: it was computed with the old multiplier.</li>
          <li>Watch the token&apos;s <C>UIMultiplierUpdated</C> event and <C>newUIMultiplier()</C> to see corporate actions coming. Chainlink publishes no corporate-action calendar.</li>
          <li>To price in USDG rather than USD, divide by the Chainlink USDG/USD feed.</li>
        </ul>
        <p>Heimdall&apos;s vaults and Auto-Invest do all five: see <A href="/security">Security</A>.</p>
      </>
    ),
  },
  {
    slug: "pay-ai-agent-escrow",
    title: "How to pay another AI agent safely: escrow on Robinhood Chain",
    description: "Pay up front and you may get nothing; pay after and the other agent carries the risk. Escrow holds the USDG until the work is delivered. Here is how it works.",
    updated: "2026-11-23",
    minutes: 5,
    tag: "AI agents",
    steps: [
      "Create the job: provider, amount in USDG, deadline, review window and, ideally, an arbiter. The USDG moves into escrow.",
      "Send the provider the exact task text. Only its hash is stored onchain.",
      "The provider delivers and submits the hash of the result.",
      "Release the payment, or dispute it within the review window if an arbiter was set.",
    ],
    body: (
      <>
        <p>Agents increasingly buy work from other agents: research, data, code, a summary. Payment has the oldest problem in trade. If the buyer pays first, the seller can walk away. If the seller works first, the buyer can refuse to pay. Escrow puts the money with a neutral party that follows rules both sides can read; on Robinhood Chain, that party is a contract.</p>

        <h2 id="flow">How a job runs in Heimdall Pay</h2>
        <ol>
          <li><strong>The client creates the job</strong>: the provider&apos;s address, the amount in USDG (at least 1), a deadline, a review window (1 hour to 30 days) and optionally an arbiter with a fee of up to 10%. The USDG moves into escrow, and the hash of the task text is stored with the job.</li>
          <li><strong>The client sends the provider the exact task text.</strong> Both sides can prove later what was asked, because its hash is onchain.</li>
          <li><strong>The provider delivers</strong> and submits the hash of the result before the deadline.</li>
          <li><strong>The client reviews.</strong> Release pays the provider at once. With an arbiter, the client can instead dispute within the review window. If the client does nothing, the provider can claim the payment once the window has passed.</li>
        </ol>

        <h2 id="edges">When things go wrong</h2>
        <ul>
          <li><strong>The provider never delivers:</strong> after the deadline the escrow can be refunded to the client.</li>
          <li><strong>The provider gives up:</strong> it can cancel, which returns the money to the client.</li>
          <li><strong>A dispute:</strong> the arbiter splits the escrow however it judges fair. If no decision comes within 14 days, anyone can settle it 50/50, with no arbiter fee.</li>
          <li><strong>A frozen address:</strong> USDG can be frozen by its issuer. A payout that cannot be delivered waits in the contract for its owner to withdraw, so it never blocks anyone else.</li>
        </ul>
        <p>Without an arbiter there is no dispute: the client&apos;s only protection is not releasing early. Set one for anything that matters.</p>

        <h2 id="trust">Choosing who to hire</h2>
        <p>Every completed job adds to a provider&apos;s public record: jobs completed, jobs disputed and USDG earned, read straight from the contract. Agents can check it with the <C>heimdall_pay_record</C> tool before hiring.</p>

        <h2 id="cost">Cost</h2>
        <p>1% of each released job at launch, fixed for that job when it is created (the contract caps it at 3%). The fee goes to $HEIM stakers and the treasury.</p>
        <p>Start a job in the <A href="/app/pay">Pay app</A>, or read <A href="/pay">how Heimdall Pay works</A>.</p>
      </>
    ),
  },
];

export const guide = (slug: string) => GUIDES.find((g) => g.slug === slug);
