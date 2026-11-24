"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { chain, short } from "@/lib/config";
import { BrandLogo, logoFor, type BrandName } from "@/components/BrandLogo";
import { LogoMark } from "@/components/Logo";

const isMobile = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** One wallet tile: a big mark, the name, and a short mono caption. Hard shadow on hover, the house style. */
function Tile({ name, caption, icon, onClick, busy, wide, logos }: { name: string; caption: string; icon: React.ReactNode; onClick: () => void; busy: boolean; wide?: boolean; logos?: BrandName[] }) {
  return (
    <button type="button" disabled={busy} onClick={onClick}
      className={`group flex flex-col gap-3 border-2 border-ink bg-panel p-4 text-left transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[4px_4px_0_var(--color-brand)] disabled:opacity-60 ${wide ? "col-span-2" : ""}`}>
      <span className="flex items-center justify-between gap-2">
        <span className="shrink-0">{icon}</span>
        {logos && <span className="flex -space-x-1.5">{logos.map((l) => <span key={l} className="rounded-full ring-2 ring-panel"><BrandLogo name={l} size={22} /></span>)}</span>}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[16px] font-semibold leading-tight group-hover:text-brand">{name}</span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">{caption}</span>
      </span>
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
  const browserTiles = announced.length || (generic && hasInjected ? 1 : 0);
  const tiles = browserTiles + (wc ? 1 : 0) + (cb ? 1 : 0);
  const here = typeof window !== "undefined" ? `${window.location.host}${window.location.pathname}` : "heimdall.fund";

  return (
    <>
      <button type="button" disabled={isPending} onClick={() => setOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-brand px-3.5 text-[13px] font-semibold text-white disabled:opacity-60">
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      {/* rendered on <body>: the sticky header is its own stacking context and would trap the dialog under other bars */}
      {open && typeof document !== "undefined" && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Connect a wallet" className="fixed inset-0 z-[10000] flex items-end justify-center bg-ink/60 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div className="flex max-h-[92vh] w-full max-w-[440px] flex-col overflow-y-auto border-2 border-ink bg-paper shadow-[6px_6px_0_var(--color-brand)] sm:max-h-[88vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 bg-ink px-5 pb-5 pt-4 text-paper">
              <div className="flex flex-col gap-3">
                <span className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-paper/70"><span className="size-2 bg-brand" />Connect · <BrandLogo name="robinhood" size={14} /> {chain.name}</span>
                <span className="display text-[40px] leading-[0.9]">Pick your<br /><span className="text-[#8FA0FF]">wallet.</span></span>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid size-9 place-items-center border border-paper/30 text-[20px] leading-none text-paper/80 hover:border-paper hover:text-paper">×</button>
            </div>
            <div className="flex flex-col gap-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              <div className="grid grid-cols-2 gap-3">
                {announced.map((c) => (
                  <Tile key={c.uid} name={c.name} caption="In this browser" busy={isPending} onClick={() => pick(c)}
                    icon={c.icon ? <img src={c.icon} alt="" width={40} height={40} className="size-10 rounded-lg" /> : (() => { const n = logoFor(c.name); return n ? <BrandLogo name={n} size={40} /> : <LogoMark size={40} />; })()} />
                ))}
                {!announced.length && generic && hasInjected && <Tile name="Browser wallet" caption="In this browser" busy={isPending} onClick={() => pick(generic)} icon={<BrandLogo name="metamask" size={40} />} />}
                {wc && <Tile wide={tiles % 2 === 1} name="Phone wallet" caption={mobile ? "Robinhood · MetaMask · Trust · Rainbow" : "Scan the QR with any phone wallet"} busy={isPending} onClick={() => { setOpen(false); pick(wc); }}
                  icon={<BrandLogo name="walletconnect" size={40} />} logos={["robinhood", "metamask", "rainbow"]} />}
                {cb && <Tile name="Coinbase Wallet" caption="App or extension" busy={isPending} onClick={() => pick(cb)} icon={<BrandLogo name="coinbase" size={40} />} />}
              </div>
              {mobile && !hasInjected && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                  <span>Open in app:</span>
                  <a className="text-ink underline decoration-brand decoration-2 underline-offset-4 hover:text-brand" href={`https://metamask.app.link/dapp/${here}`}>MetaMask</a>
                  <a className="text-ink underline decoration-brand decoration-2 underline-offset-4 hover:text-brand" href={`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(`https://${here}`)}`}>Coinbase</a>
                  <a className="text-ink underline decoration-brand decoration-2 underline-offset-4 hover:text-brand" href={`https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(`https://${here}`)}`}>Trust</a>
                </div>
              )}
              {error && <p role="alert" className="border-l-4 border-deny bg-deny-soft px-3 py-2 text-[13px] text-deny">{/rejected|denied/i.test(error.message) ? "The request was declined in the wallet." : error.message.split("\n")[0]}</p>}
              <div className="flex items-center gap-3 border-t-2 border-dashed border-line pt-4">
                <span className="flex shrink-0 gap-1 font-mono text-[10px] font-bold">
                  <span className="border border-allow px-1 text-allow">ALLOW</span><span className="border border-warn px-1 text-warn">WARN</span><span className="border border-deny px-1 text-deny">DENY</span>
                </span>
                <span className="text-[12.5px] leading-snug text-muted">Connecting signs nothing. Heimdall never asks for your seed phrase.</span>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
