"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { chain, short } from "@/lib/config";
import { BrandLogo, logoFor } from "@/components/BrandLogo";

const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** One wallet option in the picker. */
function Option({ c, onPick, busy, hint }: { c: Connector; onPick: (c: Connector) => void; busy: boolean; hint?: string }) {
  const brand = c.id === "injected" ? null : logoFor(c.name);
  return (
    <button type="button" disabled={busy} onClick={() => onPick(c)} className="flex w-full items-center gap-3 rounded-[3px] border border-line bg-panel px-4 py-3 text-left hover:border-brand disabled:opacity-60">
      {c.icon ? <img src={c.icon} alt="" width={28} height={28} className="size-7 rounded-md" /> : brand ? <BrandLogo name={brand} size={28} /> : <span className="grid size-7 place-items-center rounded-md bg-ink-2 font-mono text-[12px]">W</span>}
      <span className="flex min-w-0 flex-col"><span className="font-semibold">{c.id === "injected" ? "Browser wallet" : c.name}</span>{hint && <span className="text-[12.5px] text-muted">{hint}</span>}</span>
    </button>
  );
}

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [hasInjected, setHasInjected] = useState(false);
  useEffect(() => { setMobile(isMobile()); setHasInjected(typeof window !== "undefined" && !!(window as unknown as { ethereum?: unknown }).ethereum); }, []);
  useEffect(() => { if (isConnected) setOpen(false); }, [isConnected]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  if (isConnected && address) {
    if (chainId !== chain.id) {
      return (
        <button type="button" onClick={() => switchChain({ chainId: chain.id })} className="min-h-10 rounded-lg bg-deny px-3.5 text-[13px] font-semibold text-white">
          <span className="inline-flex items-center gap-2"><BrandLogo name="robinhood" size={18} />Switch to {chain.name}</span>
        </button>
      );
    }
    return (
      <button type="button" onClick={() => disconnect()} title="Disconnect" className="min-h-10 rounded-lg bg-brand px-3.5 font-mono text-[13px] text-white">
        {short(address)}
      </button>
    );
  }

  // wallets that announced themselves (EIP-6963) replace the generic browser entry
  const announced = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const generic = connectors.find((c) => c.id === "injected");
  const wc = connectors.find((c) => c.type === "walletConnect");
  const cb = connectors.find((c) => c.type === "coinbaseWallet");
  const pick = (c: Connector) => { reset(); connect({ connector: c, chainId: chain.id }); };
  const here = typeof window !== "undefined" ? `${window.location.host}${window.location.pathname}` : "heimdall.fund";

  return (
    <>
      <button type="button" disabled={isPending} onClick={() => setOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-3.5 text-[13px] font-semibold text-white disabled:opacity-60">
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      {/* rendered on <body>: the sticky header is its own stacking context and would trap the dialog under other bars */}
      {open && typeof document !== "undefined" && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Connect a wallet" className="fixed inset-0 z-[10000] flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="flex max-h-[90vh] w-full max-w-[420px] flex-col gap-3 overflow-y-auto rounded-t-[6px] border border-line bg-paper p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-[6px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h2 className="text-[20px] font-semibold">Connect a wallet</h2><button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-[22px] leading-none text-muted hover:text-ink">×</button></div>
            <p className="text-[13.5px] text-muted">Heimdall runs on {chain.name}. Your wallet will be asked to add or switch to it.</p>
            {announced.map((c) => <Option key={c.uid} c={c} onPick={pick} busy={isPending} hint="Detected in this browser" />)}
            {!announced.length && generic && hasInjected && <Option c={generic} onPick={pick} busy={isPending} hint="The wallet in this browser" />}
            {wc && <Option c={wc} onPick={(c) => { setOpen(false); pick(c); }} busy={isPending} hint={mobile ? "Robinhood Wallet, MetaMask, Trust, Rainbow and more" : "Scan with Robinhood Wallet, MetaMask, Trust or any phone wallet"} />}
            {cb && <Option c={cb} onPick={pick} busy={isPending} hint="Coinbase Wallet app or extension" />}
            {mobile && !hasInjected && (
              <div className="flex flex-col gap-2 border-t border-line pt-3">
                <span className="text-[12.5px] text-muted">Or open Heimdall inside your wallet&apos;s browser:</span>
                <div className="flex flex-wrap gap-2">
                  <a className="btn btn-secondary min-h-9 px-3 text-[12px]" href={`https://metamask.app.link/dapp/${here}`}>MetaMask</a>
                  <a className="btn btn-secondary min-h-9 px-3 text-[12px]" href={`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(`https://${here}`)}`}>Coinbase Wallet</a>
                  <a className="btn btn-secondary min-h-9 px-3 text-[12px]" href={`https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(`https://${here}`)}`}>Trust</a>
                </div>
              </div>
            )}
            {error && <p role="alert" className="text-[13px] text-deny">{/rejected|denied/i.test(error.message) ? "The request was declined in the wallet." : error.message.split("\n")[0]}</p>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
