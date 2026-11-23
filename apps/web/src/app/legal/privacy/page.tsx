import type { Metadata } from "next";
export const metadata: Metadata = { title: "Privacy" };
export default function Privacy() {
  return (
    <article className="flex flex-col gap-5 text-[15.5px] leading-relaxed">
      <h1 className="text-[40px]">Privacy</h1>
      <p className="text-[13px] text-muted">Last updated 23 Nov 2026 (UTC) · Draft. Final policy is published before launch.</p>
      <p>Transactions you send to Shield are processed to simulate them and count usage. We do not sell this data. Wallet addresses and onchain activity are public by nature of the blockchain.</p>
      <p>The console keeps your recent checks only in your own browser.</p>
      <p>To see which features are used, the site counts anonymous events, such as a page view or a completed revoke, as one number per event and day. No cookies are set, and no IP address, wallet address or device identifier is sent or stored. Addresses and ids in page paths are removed before anything is counted. If your browser sends Do Not Track, nothing is counted.</p>
      <p>An invite link stores its invite code in your browser (local storage, not a cookie) for up to 30 days, so it can be linked to your wallet when you join. Early access, invites and Wallet Watch keep the wallet addresses you register with them, since that is what they are for. Wallet Watch also keeps the push address your browser gives it, and you can switch it off at any time. To stop invite farming, an early-access sign-up also records how many transactions the wallet had and a one-way hash of the network it came from, salted with that day&apos;s date; neither can be turned back into an IP address.</p>
      <p>If you set up a webhook, Heimdall keeps its URL, signing secret, chosen events and watched wallets, plus a log of the last 20 deliveries (time, event, HTTP status). Deleting the webhook removes all of it.</p>
    </article>
  );
}
