import type { Metadata } from "next";
import { ApiKeys } from "./ApiKeys";
export const metadata: Metadata = { title: "API keys & webhook" };
export default function Page() {
  return (
    <div className="flex max-w-[960px] flex-col gap-6 pb-20 pt-8">
      <div className="flex flex-col gap-2.5">
        <span className="eyebrow">Shield</span>
        <h1 className="text-[30px] font-bold tracking-[-0.025em]">API keys & webhook</h1>
        <p className="leading-relaxed text-muted">Keys lift the free limits (600 checks per minute, no daily wallet cap). Sign in with your wallet; Heimdall stores only a hash of each key, so copy it when it is shown.</p>
      </div>
      <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
        {[
          ["Free", "No key needed", ["30 checks / minute per IP", "1,000 checks / day per wallet"]],
          ["API key", "$0.001 per check", ["600 checks / minute", "No daily wallet cap"]],
          ["$HEIM holder", "Free, 5× quota", ["30 checks / minute per IP", "5,000 checks / day per wallet"]],
        ].map(([name, price, rows]) => (
          <div key={name as string} className={`flex flex-col gap-3 p-5 ${name === "API key" ? "bg-brand-soft/50" : "bg-panel"}`}>
            <div><div className="text-[15px] font-semibold">{name}</div><div className="font-mono text-[13px] text-muted">{price}</div></div>
            <ul className="flex flex-col gap-1.5 text-[14px]">{(rows as string[]).map((r) => <li key={r} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-brand" />{r}</li>)}</ul>
          </div>
        ))}
      </div>
      <ApiKeys />
    </div>
  );
}
