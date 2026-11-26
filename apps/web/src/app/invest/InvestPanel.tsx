"use client";
import { track } from "@/lib/track";
import { useChainWrite } from "@/lib/chainWrite";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { heimdallAutoInvestAbi } from "@/lib/abi";
import { ADDRESSES, INVEST_TOKENS } from "@/lib/config";
import { ConnectButton } from "@/components/ConnectButton";
import { TokenIcon } from "@/components/TokenIcon";

const ERC20 = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;
const EVERY = [["Every day", 86_400], ["Every week", 604_800], ["Every 2 weeks", 1_209_600], ["Every month (30 days)", 2_592_000]] as const;
const sym = (a: string) => INVEST_TOKENS.find((t) => t.address.toLowerCase() === a.toLowerCase())?.symbol ?? "?";
const when = (s: bigint) => new Date(Number(s) * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const every = (sec: number) => EVERY.find(([, v]) => v === sec)?.[0].toLowerCase() ?? `every ${Math.round(sec / 3600)} h`;
interface Plan { owner: Address; token: Address; amountPerBuy: bigint; interval: number; maxSlippageBps: number; buysLeft: number; nextBuyAt: bigint; active: boolean; feeBps: number }

/** Same window as HeimdallWeekdayFeed: Saturday 00:00 to Monday 01:00 UTC. */
const weekendClosed = () => { const t = (Math.floor(Date.now() / 1000) % (7 * 86_400)); return t >= 2 * 86_400 && t < 4 * 86_400 + 3_600; };

export function InvestPanel({ ai }: { ai: Address }) {
  const { address } = useAccount();
  const [closed, setClosed] = useState(false); // read the clock after mount: Date.now() cannot run during prerender
  useEffect(() => setClosed(weekendClosed()), []);
  const pc = usePublicClient();
  const { writeContractAsync } = useChainWrite();
  const [token, setToken] = useState(INVEST_TOKENS[0].address);
  const [amount, setAmount] = useState("50");
  const [interval, setIntervalSec] = useState<number>(604_800);
  const [buys, setBuys] = useState("12");
  const [slip, setSlip] = useState("1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: prices } = useReadContracts({ contracts: INVEST_TOKENS.map((t) => ({ address: ai, abi: heimdallAutoInvestAbi, functionName: "oraclePrice", args: [t.address] })), query: { refetchInterval: 30_000 } });
  const { data: ids, refetch } = useReadContract({ address: ai, abi: heimdallAutoInvestAbi, functionName: "plansOf", args: [address ?? "0x0000000000000000000000000000000000000000"], query: { enabled: !!address } });
  const list = useMemo(() => [...((ids as readonly bigint[] | undefined) ?? [])].reverse(), [ids]);
  const { data: rawPlans, refetch: refetchPlans } = useReadContracts({ contracts: list.map((id) => ({ address: ai, abi: heimdallAutoInvestAbi, functionName: "getPlan", args: [id] })), query: { enabled: list.length > 0 } });
  const plans = (rawPlans ?? []).flatMap((r, i) => (r.status === "success" ? [{ id: list[i], ...(r.result as unknown as Plan) }] : []));

  const price = prices?.[INVEST_TOKENS.findIndex((t) => t.address === token)]?.result as bigint | undefined;
  const per = Number(amount) || 0, n = Math.max(0, Math.floor(Number(buys) || 0));
  const valid = per >= 1 && n >= 1 && n <= 520 && Number(slip) >= 0.1 && Number(slip) <= 5;
  const approxEach = price && per ? (per * 0.9975) / Number(formatUnits(price, 6)) : null;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!pc || !address || !valid) return;
    setBusy(true); setMsg(null);
    try {
      const each = parseUnits(amount, 6), budget = each * BigInt(n);
      const allowance = await pc.readContract({ address: ADDRESSES.usdg, abi: ERC20, functionName: "allowance", args: [address, ai] });
      if (allowance < budget) await pc.waitForTransactionReceipt({ hash: await writeContractAsync({ address: ADDRESSES.usdg, abi: ERC20, functionName: "approve", args: [ai, budget] }) });
      await pc.waitForTransactionReceipt({ hash: await writeContractAsync({ address: ai, abi: heimdallAutoInvestAbi, functionName: "createPlan", args: [token, each, interval, n, Math.round(Number(slip) * 100)] }) });
      track("plan_created");
      setMsg({ ok: true, text: "Plan started. The first buy goes through within minutes." });
      await refetch(); await refetchPlans();
    } catch (err) { setMsg({ ok: false, text: (err as { shortMessage?: string }).shortMessage ?? "Cancelled." }); }
    finally { setBusy(false); }
  }
  async function cancel(id: bigint) {
    if (!pc) return;
    setBusy(true);
    try { await pc.waitForTransactionReceipt({ hash: await writeContractAsync({ address: ai, abi: heimdallAutoInvestAbi, functionName: "cancelPlan", args: [id] }) }); await refetchPlans(); }
    catch { /* cancelled */ } finally { setBusy(false); }
  }

  const input = "min-h-11 rounded-lg border border-line px-3 text-[15px] outline-none focus:border-brand";
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <section className="flex min-w-0 flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {INVEST_TOKENS.map((t, i) => {
            const p = prices?.[i]?.result as bigint | undefined;
            return <div key={t.symbol} className="card p-4"><p className="flex items-center justify-between gap-2 text-[13px] text-muted"><span className="truncate">{t.name}</span>{t.weekdays && <span className="shrink-0 rounded-sm bg-ink-2 px-1.5 py-0.5 text-[11px] font-semibold">Mon–Fri</span>}</p><p className="mt-1 flex items-center gap-2 font-mono text-[20px] font-semibold"><TokenIcon symbol={t.symbol} size={24} />{t.symbol}</p><p className="font-mono text-[14px] text-muted">{p ? `$${Number(formatUnits(p, 6)).toFixed(2)}` : t.weekdays && closed ? "Market closed" : "—"}</p></div>;
          })}
        </div>
        <div className="card min-w-0 overflow-hidden">
          <div className="border-b border-line px-5 py-4"><h2 className="text-[17px] font-semibold">Your plans</h2></div>
          {!address ? <div className="flex flex-col items-start gap-3 p-5"><p className="text-[14.5px] text-muted">Connect a wallet to see your plans.</p><ConnectButton /></div>
            : plans.length === 0 ? <p className="px-5 py-8 text-center text-[14.5px] text-muted">No plans yet.</p> : (
            <ul className="divide-y divide-line">
              {plans.map((p) => (
                <li key={String(p.id)} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div><p className="text-[15px] font-semibold">{formatUnits(p.amountPerBuy, 6)} USDG of {sym(p.token)} {every(p.interval)}</p>
                    <p className="text-[13px] text-muted">{p.active ? `${p.buysLeft} buy${p.buysLeft === 1 ? "" : "s"} left · next ${when(p.nextBuyAt)} · max ${p.maxSlippageBps / 100}% off the oracle` : "Finished or cancelled"}</p></div>
                  {p.active && <button type="button" disabled={busy} onClick={() => cancel(p.id)} className="min-h-10 rounded-lg border border-line px-4 text-[14px] font-semibold hover:bg-ink-2 disabled:opacity-50">Stop</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <form onSubmit={create} className="card flex flex-col gap-4 p-5">
        <h2 className="text-[17px] font-semibold">New plan</h2>
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-ink-2 p-1">
          {INVEST_TOKENS.map((t) => <button key={t.symbol} type="button" onClick={() => setToken(t.address)} className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg text-[14.5px] font-semibold ${token === t.address ? "bg-white shadow-sm" : "text-muted"}`}><TokenIcon symbol={t.symbol} size={18} />{t.symbol}</button>)}
        </div>
        <label className="flex flex-col gap-1.5 text-[13.5px] font-medium">Amount per buy (USDG)<input className={`${input} font-mono`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" /></label>
        <label className="flex flex-col gap-1.5 text-[13.5px] font-medium">How often<select className={input} value={interval} onChange={(e) => setIntervalSec(Number(e.target.value))}>{EVERY.map(([l, v]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-[13.5px] font-medium">Number of buys<input className={`${input} font-mono`} value={buys} onChange={(e) => setBuys(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></label>
          <label className="flex flex-col gap-1.5 text-[13.5px] font-medium">Max off oracle (%)<input className={`${input} font-mono`} value={slip} onChange={(e) => setSlip(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" /></label>
        </div>
        <div className="rounded-xl bg-ink-2 px-4 py-3 text-[14px]">
          <div className="flex justify-between"><span className="text-muted">Total budget</span><span className="font-mono font-semibold">{(per * n).toLocaleString("en-US")} USDG</span></div>
          {approxEach && <div className="mt-1 flex justify-between"><span className="text-muted">Each buy today</span><span className="font-mono">≈ {approxEach.toFixed(4)} {sym(token)}</span></div>}
        </div>
        {address ? <button type="submit" disabled={busy || !valid} className="btn btn-primary min-h-12 disabled:opacity-50">{busy ? "Confirm in wallet…" : "Start plan"}</button> : <ConnectButton />}
        {msg && <p role="status" className={`text-[13.5px] ${msg.ok ? "text-allow" : "text-deny"}`}>{msg.text}</p>}
        <p className="text-[12.5px] leading-relaxed text-muted">Your USDG stays in your wallet until each buy. Stocks go straight to you. Stocks marked Mon–Fri are priced on weekdays only: a buy that falls on the weekend runs on Monday. 0.25% per buy goes to $HEIM stakers, and the fee your plan starts with never changes. Stop any time.</p>
      </form>
    </div>
  );
}
