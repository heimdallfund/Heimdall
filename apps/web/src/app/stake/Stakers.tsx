import { connection } from "next/server";
import { explorerAddress } from "@/lib/config";
import { readStakers } from "@/lib/stakers";

const n = (v: number, d = 0) => v.toLocaleString("en-US", { maximumFractionDigits: d });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Top $HEIM stakers, their share of the pool and what that share earns at today's payout rate. */
export async function Stakers() {
  await connection();
  const b = await readStakers(10).catch(() => null);
  if (!b) return null;
  return (
    <section aria-labelledby="stakers" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="stakers" className="display text-[35px]">Stakers</h2>
        <p className="text-[13px] text-muted">{n(b.count)} wallet{b.count === 1 ? "" : "s"} · {n(b.total)} $HEIM staked · live from Robinhood Chain</p>
      </div>
      {b.stakers.length === 0 ? (
        <p className="card p-6 text-[15px] text-muted">No one has staked yet. The first staker takes 100% of the stakers&apos; share of fees.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full min-w-[520px] border-collapse text-left text-[15px]">
            <thead><tr className="bg-ice text-[13px]"><th scope="col" className="px-5 py-3 font-semibold">#</th><th scope="col" className="px-5 py-3 font-semibold">Wallet</th><th scope="col" className="px-5 py-3 text-right font-semibold">Staked</th><th scope="col" className="px-5 py-3 text-right font-semibold">Share</th><th scope="col" className="px-5 py-3 text-right font-semibold">USDG / week now</th></tr></thead>
            <tbody>{b.stakers.map((s, i) => (
              <tr key={s.address} className="border-t border-line">
                <td className="px-5 py-3 font-mono text-[14px] text-muted">{i + 1}</td>
                <td className="px-5 py-3 font-mono text-[14px]"><a href={explorerAddress(s.address)} className="hover:text-brand">{short(s.address)}</a></td>
                <td className="px-5 py-3 text-right font-mono text-[14px]">{n(s.staked)}</td>
                <td className="px-5 py-3 text-right font-mono text-[14px]">{(s.share * 100).toFixed(2)}%</td>
                <td className="px-5 py-3 text-right font-mono text-[14px] text-allow">{s.usdgPerWeek === null ? "—" : n(s.usdgPerWeek, 2)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="text-[13px] text-muted">USDG / week is each wallet&apos;s share of what the staking contract is paying out right now. It changes with fees and with how much is staked; it is not a promise.</p>
    </section>
  );
}
