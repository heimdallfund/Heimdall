import type { Metadata } from "next";

export const metadata: Metadata = { title: "Brand kit", description: "Heimdall logos, the $HEIM token icon, colors and naming, free to use when writing about Heimdall." };

const ASSETS = [
  { file: "mark.svg", name: "Mark", note: "SVG, on light backgrounds", dark: false },
  { file: "mark-white.svg", name: "Mark, white", note: "SVG, on dark or brand backgrounds", dark: true },
  { file: "logo-horizontal.svg", name: "Logo with wordmark", note: "SVG", dark: false },
  { file: "icon512.png", name: "App icon", note: "PNG, 512 × 512", dark: false },
  { file: "token.png", name: "$HEIM token icon", note: "PNG, 512 × 512, for trackers and wallets", dark: false },
  { file: "banner.png", name: "Banner", note: "PNG, 1500 × 500", dark: false },
];
const COLORS = [
  ["Heimdall blue", "#3355FF"], ["Deep blue", "#2546F0"], ["Ink", "#1B2233"], ["Periwinkle", "#7C95FF"], ["Sky", "#A8BDFF"], ["Ice", "#F8F9FB"],
];

export default function BrandPage() {
  return (
    <div className="mx-auto flex max-w-[1080px] flex-col gap-12 px-6 pb-24 pt-12">
      <header className="flex max-w-[680px] flex-col gap-3">
        <span className="eyebrow">Press</span>
        <h1 className="text-[50px]">Brand kit</h1>
        <p className="text-[17px] leading-relaxed text-muted">Logos and colors for anyone writing about Heimdall, listing $HEIM or building on it. Use them as they are: no recoloring, stretching or effects.</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ASSETS.map((a) => (
          <a key={a.file} href={`/brand/${a.file}`} download className="card group flex flex-col overflow-hidden hover:border-brand/50">
            <div className={`flex h-40 items-center justify-center p-6 ${a.dark ? "bg-brand" : "bg-ice"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/brand/${a.file}`} alt={a.name} className="max-h-full max-w-full object-contain" loading="lazy" />
            </div>
            <div className="flex items-center justify-between gap-3 p-4">
              <div><p className="font-semibold">{a.name}</p><p className="text-[13px] text-muted">{a.note}</p></div>
              <span className="text-[14px] font-semibold text-brand group-hover:underline">Download</span>
            </div>
          </a>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="display text-[35px]">Colors</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {COLORS.map(([n, hex]) => (
            <div key={hex} className="card overflow-hidden">
              <div className="h-20 border-b border-line" style={{ background: hex }} />
              <div className="p-3"><p className="text-[14px] font-semibold">{n}</p><p className="font-mono text-[13px] text-muted">{hex}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="card flex flex-col gap-2 p-6">
          <h2 className="text-[20px] font-bold">Naming</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-ink/85">
            <li>Write <b>Heimdall</b>, with a capital H. The token is <b>$HEIM</b>.</li>
            <li>Products: Heimdall Shield, Wallet Check, Heimdall Pay, Auto-Invest, Signals, Agent Arena, Guardian Points.</li>
            <li>Heimdall runs on Robinhood Chain. It is not made by, or affiliated with, Robinhood.</li>
          </ul>
        </div>
        <div className="card flex flex-col gap-2 p-6">
          <h2 className="text-[20px] font-bold">One line about Heimdall</h2>
          <p className="text-[15px] leading-relaxed text-ink/85">Heimdall is the guardian layer for AI agents on Robinhood Chain: it checks every transaction and signature before it is signed, and its vaults let agents trade without ever being able to take depositor money.</p>
          <p className="mt-2 text-[14px] text-muted">Press and partnerships: <a className="font-medium text-brand hover:underline" href="mailto:hello@heimdall.fund">hello@heimdall.fund</a></p>
        </div>
      </section>
    </div>
  );
}
