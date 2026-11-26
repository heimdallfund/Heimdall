import Link from "next/link";
import Image from "next/image";
import { connection } from "next/server";
import { readHeimMarket } from "@/lib/heimMarket";
import { BrandLogo } from "@/components/BrandLogo";

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(3)}`);
const big = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));

/** $HEIM live on the home page: price, market cap, holders and staked, with Buy and Stake. Hidden until $HEIM exists. */
export async function HeimStrip() {
  await connection();
  const m = await readHeimMarket().catch(() => null);
  if (!m) return null;
  const cells: [string, string][] = [
    ["Price", m.priceUsd !== null ? usd(m.priceUsd) : "—"],
    ["Market cap", m.marketCapUsd !== null ? usd(m.marketCapUsd) : "—"],
    ["Holders", m.holders !== null ? m.holders.toLocaleString("en-US") : "—"],
    ["Staked", m.staked !== null ? big(m.staked) : "—"],
  ];
  if (m.progressPct !== null) cells.push(["Pons curve", `${m.progressPct.toFixed(1)}%`]);
  const buy = m.graduated ? `https://app.uniswap.org/swap?chain=robinhood&outputCurrency=${m.token}` : `https://ponsfamily.com/launchpad/${m.token}`;
  return (
    <section aria-label="$HEIM" className="border-y border-ink bg-ink text-paper">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-6 py-5 lg:flex-row lg:items-center lg:gap-10">
        <Link href="/token" className="flex shrink-0 items-center gap-3">
          <Image src="/brand/token.png" alt="" width={40} height={40} className="rounded-full" />
          <span className="flex flex-col">
            <span className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-paper/60"><span className="size-2 rounded-full bg-[#3DDC84]" />Live</span>
            <span className="text-[20px] font-bold">$HEIM</span>
          </span>
        </Link>
        <dl className="grid flex-1 grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:flex lg:gap-10">
          {cells.map(([k, v]) => <div key={k}><dt className="text-[12px] text-paper/60">{k}</dt><dd className="font-mono text-[17px]">{v}</dd></div>)}
        </dl>
        <div className="flex shrink-0 gap-3">
          <a href={buy} target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-lg bg-paper px-4 py-2.5 text-[14px] font-semibold text-ink hover:bg-paper/90">
            {m.graduated ? <BrandLogo name="uniswap" size={18} /> : <Image src="/logos/pons.png" alt="" width={18} height={18} className="rounded" />}Buy
          </a>
          <Link href="/stake" className="inline-flex items-center rounded-lg border border-paper/40 px-4 py-2.5 text-[14px] font-semibold hover:border-paper">Stake → earn USDG</Link>
        </div>
      </div>
    </section>
  );
}
