"use client";
import { useState } from "react";
import { CopyButton } from "@/components/docs/DocsChrome";

/** Pick a badge, paste an address, copy the embed code. */
export function BadgeBuilder({ site }: { site: string }) {
  const [kind, setKind] = useState<"agent" | "vault">("agent");
  const [addr, setAddr] = useState("");
  const ok = /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
  const a = ok ? addr.trim() : "0xYourAddress";
  const img = `${site}/badge/${kind}/${a}`;
  const link = kind === "agent" ? `${site}/agent/${a}` : `${site}/vaults/${a}`;
  const html = `<a href="${link}"><img src="${img}" alt="Verified by Heimdall" height="20"></a>`;
  const md = `[![Verified by Heimdall](${img})](${link})`;
  return (
    <div className="card flex flex-col gap-5 p-6">
      <div className="grid grid-cols-2 gap-1 self-start rounded-xl bg-ink-2 p-1">
        {(["agent", "vault"] as const).map((k) => <button key={k} type="button" onClick={() => setKind(k)} className={`min-h-10 rounded-lg px-5 text-[15px] font-semibold capitalize ${kind === k ? "bg-white shadow-sm" : "text-muted"}`}>{k === "agent" ? "Agent wallet" : "Vault"}</button>)}
      </div>
      <label className="flex flex-col gap-1.5 text-[14px] font-medium">{kind === "agent" ? "Agent wallet address" : "Vault address"}
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x…" spellCheck={false} className="min-h-11 rounded-lg border border-line px-3 font-mono text-[14px] outline-none focus:border-brand" />
      </label>
      <div className="flex min-h-12 items-center rounded-xl border border-dashed border-line bg-ice px-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {ok ? <img src={`/badge/${kind}/${a}`} alt="Badge preview" height={20} /> : <span className="text-[14px] text-muted">Paste an address to preview the live badge.</span>}
      </div>
      {[["HTML", html], ["Markdown (README)", md]].map(([t, code]) => (
        <div key={t} className="overflow-hidden rounded-xl border border-line">
          <div className="flex items-center justify-between border-b border-line bg-ice px-4 py-1.5"><span className="text-[12px] font-medium text-muted">{t}</span><CopyButton text={code} /></div>
          <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px]">{code}</pre>
        </div>
      ))}
    </div>
  );
}
