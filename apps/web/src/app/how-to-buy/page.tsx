/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { BrandLogo } from "@/components/BrandLogo";
import { heimAddress } from "@/lib/heim";
import { readHeimMarket } from "@/lib/heimMarket";
import { AddChain, CopyCA } from "./AddChain";

export const metadata: Metadata = { title: "How to buy $HEIM", description: "Wallet, Robinhood Chain, ETH, then $HEIM on Pons: the five steps, with the one contract address to trust." };

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card flex gap-5 p-6">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[15px] font-semibold text-paper">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-3"><h2 className="text-[22px] font-semibold">{title}</h2>{children}</div>
    </section>
  );
}

async function Buy() {
  await connection();
  const [ca, m] = await Promise.all([heimAddress(), readHeimMarket().catch(() => null)]);
  if (!ca) return <p className="text-[15px] text-muted">The contract address appears here the moment $HEIM launches.</p>;
  const graduated = !!m?.graduated;
  return (
    <>
      <p className="text-[15px] leading-relaxed text-muted">{graduated
        ? "$HEIM has graduated from its Pons curve and trades on Uniswap. Paste the contract address, choose an amount of ETH and swap."
        : `$HEIM is still on its Pons bonding curve${m?.progressPct != null ? ` (${m.progressPct.toFixed(1)}% to graduation)` : ""}. Open it on Pons, choose an amount of ETH and buy. 1% trading fee, no tax.`}</p>
      <CopyCA ca={ca} />
      <div className="flex flex-wrap gap-3">
        {graduated
          ? <a href={`https://app.uniswap.org/swap?outputCurrency=${ca}`} target="_blank" rel="noopener" className="btn btn-primary inline-flex min-h-11 items-center gap-2 px-5"><BrandLogo name="uniswap" size={20} />Buy on Uniswap</a>
          : <a href={`https://ponsfamily.com/launchpad/${ca}`} target="_blank" rel="noopener" className="btn btn-primary inline-flex min-h-11 items-center gap-2 px-5"><img src="/logos/pons.png" alt="" width={20} height={20} className="rounded" />Buy on Pons</a>}
        <Link href={`/token-check/${ca}`} className="btn btn-secondary min-h-11 px-5">See $HEIM&apos;s Token Check</Link>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-6 px-5 pb-20 pt-14 md:px-8">
      <header className="flex flex-col gap-3">
        <span className="eyebrow">$HEIM</span>
        <h1 className="text-[48px] md:text-[64px]">How to buy $HEIM</h1>
        <p className="max-w-[620px] text-[18px] leading-relaxed text-muted">Five steps, about ten minutes the first time. $HEIM lives on Robinhood Chain, an Ethereum Layer 2 where gas is paid in ETH.</p>
      </header>

      <div className="rounded-xl border border-warn bg-warn-soft px-5 py-4 text-[14.5px] leading-relaxed">
        <b>Only trust the contract address on <Link href="/token" className="underline">heimdall.fund/token</Link>.</b> Copycat tokens use the same name and logo. Heimdall never DMs you, and nobody from Heimdall will ask for your seed phrase.
      </div>

      <Step n={1} title="Get a wallet">
        <p className="text-[15px] leading-relaxed text-muted">Any EVM wallet works. Install one, write the recovery phrase down on paper and keep it offline.</p>
        <div className="flex flex-wrap gap-2">
          {([["metamask", "MetaMask"], ["rabby", "Rabby"], ["coinbase", "Coinbase Wallet"], ["rainbow", "Rainbow"], ["phantom", "Phantom"]] as const).map(([k, l]) => (
            <span key={k} className="inline-flex items-center gap-2 rounded-full border border-line bg-panel py-1.5 pl-1.5 pr-3.5 text-[14px] font-medium"><BrandLogo name={k} size={24} />{l}</span>
          ))}
        </div>
      </Step>

      <Step n={2} title="Add Robinhood Chain">
        <AddChain />
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-xl bg-ice px-5 py-4 text-[14px]">
          <dt className="text-muted">Network</dt><dd className="inline-flex items-center gap-2 font-medium"><BrandLogo name="robinhood" size={18} />Robinhood Chain</dd>
          <dt className="text-muted">Chain ID</dt><dd className="font-mono">4663</dd>
          <dt className="text-muted">RPC</dt><dd className="break-all font-mono">https://rpc.mainnet.chain.robinhood.com</dd>
          <dt className="text-muted">Currency</dt><dd className="font-mono">ETH</dd>
          <dt className="text-muted">Explorer</dt><dd className="break-all font-mono">https://robinhoodchain.blockscout.com</dd>
        </dl>
      </Step>

      <Step n={3} title="Get ETH on Robinhood Chain">
        <p className="text-[15px] leading-relaxed text-muted">Bridge ETH from Ethereum or another chain. Keep a little extra on Robinhood Chain for gas: every transaction costs a few cents.</p>
        <ul className="flex flex-col gap-2 text-[15px]">
          <li className="flex items-start gap-3"><BrandLogo name="arbitrum" size={24} /><span><a href="https://portal.arbitrum.io/bridge" target="_blank" rel="noopener" className="font-semibold text-brand hover:underline">Arbitrum bridge</a>: the official bridge from Ethereum. Pick Robinhood Chain as the destination; deposits arrive in about ten minutes.</span></li>
          <li className="flex items-start gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-[22%] border border-line bg-white text-[11px] font-bold">J</span><span><a href="https://jumper.exchange" target="_blank" rel="noopener" className="font-semibold text-brand hover:underline">Jumper</a>: from 50+ chains in one transaction, including Arbitrum, Base and Solana.</span></li>
        </ul>
        <p className="text-[13px] text-muted">Fake bridge sites exist. Use the links above, or the list in <a href="https://docs.robinhood.com/chain/bridging/" target="_blank" rel="noopener" className="underline">Robinhood&apos;s docs</a>.</p>
      </Step>

      <Step n={4} title="Buy $HEIM">
        <Suspense fallback={<div className="h-[120px] animate-pulse rounded-xl bg-ice" />}><Buy /></Suspense>
      </Step>

      <Step n={5} title="Stake it (optional)">
        <p className="text-[15px] leading-relaxed text-muted">Stake $HEIM to earn half of every Heimdall fee, paid in USDG. No lock-up. Holding or staking 5,000,000 also makes Heimdall cheaper: 5× free Shield checks, a 12.5% vault fee and the 95/5 Signals split.</p>
        <div className="flex flex-wrap gap-3"><Link href="/stake" className="btn btn-primary min-h-11 px-5">Stake $HEIM</Link><Link href="/token" className="btn btn-secondary min-h-11 px-5">What $HEIM does</Link></div>
      </Step>

      <p className="text-[13px] text-muted">Nothing here is financial advice. Memecoins and new tokens can lose all their value; read the <Link href="/legal/risk" className="underline">risk disclosure</Link>.</p>
    </div>
  );
}
