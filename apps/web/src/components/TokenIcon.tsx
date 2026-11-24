/* eslint-disable @next/next/no-img-element */
const palette = ["#E9F5E1:#3D7A12", "#FDE8E9:#B42318", "#EEF0FF:#3B2BB0", "#E3F7F4:#0E8F84", "#FFF1DE:#A44B00", "#FBEAFB:#8A2C8F"];

/**
 * Token logos. Crypto tokens use their own round logo; stock tokens show the company's mark on a white coin.
 * Anything not listed falls back to its initials.
 */
const COINS: Record<string, string> = {
  USDG: "/logos/token-USDG.png", ETH: "/logos/token-ETH.svg", WETH: "/logos/token-ETH.svg", USDC: "/logos/token-USDC.svg", HEIM: "/tokens/HEIM.png",
};
const STOCKS: Record<string, string> = {
  NVDA: "/logos/stock-NVDA.svg", TSLA: "/logos/stock-TSLA.svg", GOOGL: "/logos/stock-GOOGL.svg", GOOG: "/logos/stock-GOOGL.svg", AAPL: "/logos/stock-AAPL.svg",
  AMZN: "/logos/stock-AMZN.png", MSFT: "/logos/stock-MSFT.png", QQQ: "/logos/stock-QQQ.png", GME: "/logos/stock-GME.png", MU: "/logos/stock-MU.png", USO: "/logos/stock-USO.png", SGOV: "/logos/stock-SGOV.png",
  META: "/logos/stock-META.svg", COIN: "/logos/stock-COIN.svg", SPCX: "/logos/stock-SPCX.svg", CRCL: "/logos/stock-CRCL.svg", DELL: "/logos/stock-DELL.svg",
};
/** Marks drawn in white: they sit on a dark coin. */
const DARK = new Set(["AMZN", "GME", "QQQ", "SGOV"]);
export const TOKEN_LOGOS = new Set<string>([...Object.keys(COINS), ...Object.keys(STOCKS)]);

/** `plain` skips the logo: a fake token with a real ticker must not borrow the real token's logo. */
export function TokenIcon({ symbol, size = 28, plain = false }: { symbol: string; size?: number; plain?: boolean }) {
  const sym = symbol.toUpperCase();
  if (!plain && COINS[sym]) return <img src={COINS[sym]} alt="" width={size} height={size} className="shrink-0 rounded-full" />;
  if (!plain && STOCKS[sym]) {
    const inner = Math.round(size * 0.56);
    return (
      <span aria-hidden="true" style={{ width: size, height: size }} className={`inline-flex shrink-0 items-center justify-center rounded-full border ${DARK.has(sym) ? "border-ink bg-ink" : "border-line bg-white"}`}>
        <img src={STOCKS[sym]} alt="" width={inner} height={inner} />
      </span>
    );
  }
  const [bg, fg] = palette[[...sym].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length].split(":");
  return (
    <span aria-hidden="true" style={{ width: size, height: size, background: bg, color: fg }} className="inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold">
      {sym.slice(0, 2)}
    </span>
  );
}

/** A symbol with its logo, inline. */
export function TokenLabel({ symbol, size = 18, className = "" }: { symbol: string; size?: number; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 ${className}`}><TokenIcon symbol={symbol} size={size} />{symbol}</span>;
}

const SYMBOLS = /\b(USDG|USDC|WETH|ETH|NVDA|TSLA|GOOGL|AAPL|AMZN|MSFT|META|COIN|QQQ|SPCX|GME|MU|CRCL|DELL|USO|SGOV|HEIM)\b/g;
/** Text with a small logo before every token symbol it mentions ("Swap 2,500 USDG → NVDA"). */
export function TokenText({ text, size = 14 }: { text: string; size?: number }) {
  const parts = text.split(SYMBOLS);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1
        ? <span key={i} className="inline-flex items-center gap-1 align-[-0.2em]"><TokenIcon symbol={p} size={size} />{p}</span>
        : <span key={i}>{p}</span>))}
    </>
  );
}
