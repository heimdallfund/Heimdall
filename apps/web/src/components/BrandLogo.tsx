/* eslint-disable @next/next/no-img-element */
/**
 * Third-party logos (public/logos), so chains, tokens, wallets and tools show their mark next to their name.
 * Sources: web3icons (networks, wallets, exchanges, crypto tokens, MIT), Simple Icons (company and tool marks, CC0),
 * Trust Wallet assets (USDG). Used only to name the product we integrate with, never as an endorsement.
 */
import { TokenIcon } from "@/components/TokenIcon";

export type BrandName =
  | "robinhood" | "uniswap" | "chainlink" | "safe" | "ethereum" | "arbitrum"
  | "metamask" | "rabby" | "coinbase" | "rainbow" | "walletconnect" | "phantom"
  | "claude" | "anthropic" | "cursor" | "langchain" | "vercel" | "mcp" | "openzeppelin" | "gitbook" | "github" | "x" | "alchemy";

/** square = the file already has its own background; mark = a bare mark, shown on a white tile */
const FILES: Record<BrandName, { src: string; kind: "square" | "mark" | "round" }> = {
  robinhood: { src: "/logos/robinhood-badge.svg", kind: "square" },
  uniswap: { src: "/logos/uniswap.svg", kind: "mark" },
  chainlink: { src: "/logos/chainlink.svg", kind: "mark" },
  safe: { src: "/logos/safe.svg", kind: "mark" },
  ethereum: { src: "/logos/ethereum.svg", kind: "mark" },
  arbitrum: { src: "/logos/arbitrum.svg", kind: "mark" },
  metamask: { src: "/logos/metamask.svg", kind: "mark" },
  rabby: { src: "/logos/rabby.svg", kind: "mark" },
  coinbase: { src: "/logos/coinbase.svg", kind: "mark" },
  rainbow: { src: "/logos/rainbow.svg", kind: "mark" },
  walletconnect: { src: "/logos/walletconnect.svg", kind: "mark" },
  phantom: { src: "/logos/phantom.svg", kind: "mark" },
  claude: { src: "/logos/claude.svg", kind: "mark" },
  anthropic: { src: "/logos/anthropic.svg", kind: "mark" },
  cursor: { src: "/logos/cursor.svg", kind: "mark" },
  langchain: { src: "/logos/langchain.svg", kind: "mark" },
  vercel: { src: "/logos/vercel.svg", kind: "mark" },
  mcp: { src: "/logos/mcp.svg", kind: "mark" },
  openzeppelin: { src: "/logos/openzeppelin.svg", kind: "mark" },
  gitbook: { src: "/logos/gitbook.svg", kind: "mark" },
  github: { src: "/logos/github.svg", kind: "mark" },
  x: { src: "/logos/x.svg", kind: "mark" },
  alchemy: { src: "/logos/alchemy.svg", kind: "mark" },
};

export function BrandLogo({ name, size = 20, tile = true, className = "" }: { name: BrandName; size?: number; tile?: boolean; className?: string }) {
  const f = FILES[name];
  if (f.kind === "square" || !tile) {
    return <img src={f.src} alt="" width={size} height={size} className={`shrink-0 ${f.kind === "square" ? "rounded-[22%]" : ""} ${className}`} />;
  }
  const inner = Math.round(size * 0.68);
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className={`inline-flex shrink-0 items-center justify-center rounded-[22%] border border-line bg-white ${className}`}>
      <img src={f.src} alt="" width={inner} height={inner} />
    </span>
  );
}

/** Best-effort match from a product name in the UI ("Claude Desktop", "Coinbase Wallet") to its logo. */
export function logoFor(label: string): BrandName | null {
  const l = label.toLowerCase();
  const pairs: [string, BrandName][] = [
    ["claude", "claude"], ["cursor", "cursor"], ["langchain", "langchain"], ["vercel", "vercel"], ["ai sdk", "vercel"], ["ai-sdk", "vercel"],
    ["metamask", "metamask"], ["rabby", "rabby"], ["coinbase", "coinbase"], ["rainbow", "rainbow"], ["walletconnect", "walletconnect"], ["phantom", "phantom"],
    ["robinhood", "robinhood"], ["uniswap", "uniswap"], ["chainlink", "chainlink"], ["safe", "safe"], ["mcp", "mcp"],
  ];
  return pairs.find(([k]) => l.includes(k))?.[1] ?? null;
}

/** "Robinhood Chain" with its mark, for chips, footers and network labels. */
export function ChainName({ size = 18, className = "", label = "Robinhood Chain" }: { size?: number; className?: string; label?: string }) {
  return <span className={`inline-flex items-center gap-2 ${className}`}><BrandLogo name="robinhood" size={size} />{label}</span>;
}

/** A row of "logo + name" chips: what a product runs on or plugs into. Pass a token symbol as `token` to use its coin logo. */
export function LogoRow({ items, className = "" }: { items: { brand?: BrandName; token?: string; label: string }[]; className?: string }) {
  return (
    <ul className={`flex flex-wrap items-center gap-2 ${className}`}>
      {items.map((it) => (
        <li key={it.label} className="inline-flex items-center gap-2 rounded-sm border border-line bg-white py-1 pl-1 pr-3 text-[13.5px] font-medium text-ink/80">
          {it.brand ? <BrandLogo name={it.brand} size={22} /> : it.token ? <TokenIcon symbol={it.token} size={22} /> : null}
          {it.label}
        </li>
      ))}
    </ul>
  );
}
