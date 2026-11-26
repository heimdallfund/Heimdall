"use client";
import { useState } from "react";
import { chain } from "@/lib/config";

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

/** One click: the browser wallet adds Robinhood Chain (or switches to it if it already knows it). */
export function AddChain() {
  const [msg, setMsg] = useState<string | null>(null);
  async function add() {
    const eth = (window as unknown as { ethereum?: Eth }).ethereum;
    if (!eth) { setMsg("No browser wallet found. Open this page in your wallet's browser, or add the network by hand below."); return; }
    const id = `0x${chain.id.toString(16)}`;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: id }] });
      setMsg("Robinhood Chain is selected in your wallet.");
    } catch {
      try {
        await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: id, chainName: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"], blockExplorerUrls: ["https://robinhoodchain.blockscout.com"] }] });
        setMsg("Robinhood Chain was added to your wallet.");
      } catch { setMsg("Cancelled in the wallet. You can also add it by hand with the details below."); }
    }
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" onClick={add} className="btn btn-primary min-h-11 px-5">Add Robinhood Chain to my wallet</button>
      {msg && <p role="status" className="text-[14px] text-muted">{msg}</p>}
    </div>
  );
}

export function CopyCA({ ca }: { ca: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(ca); setDone(true); setTimeout(() => setDone(false), 1500); } catch {} }}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-left hover:border-ink">
      <span className="break-all font-mono text-[14px]">{ca}</span>
      <span className="shrink-0 text-[13px] font-semibold text-brand">{done ? "Copied" : "Copy"}</span>
    </button>
  );
}
