import type { Metadata } from "next";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { PageViews } from "@/components/PageViews";
import { Suspense } from "react";
import { Header, HeaderFallback } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { LiveBar } from "@/components/LiveBar";
import { SmoothScroll } from "@/components/motion/SmoothScroll";
import localFont from "next/font/local";

// Self-hosted variable fonts: no render-blocking request to Google, preloaded with the HTML.
const inter = localFont({ src: "./fonts/inter-latin-wght-normal.woff2", weight: "100 900", variable: "--font-inter", display: "swap" });
const sora = localFont({ src: "./fonts/sora-latin-wght-normal.woff2", weight: "100 800", variable: "--font-sora", display: "swap" });
const mono = localFont({ src: "./fonts/jetbrains-mono-latin-wght-normal.woff2", weight: "100 800", variable: "--font-jbmono", display: "swap" });
// Archivo with its width axis: the condensed display face for headlines
const archivo = localFont({ src: "./fonts/archivo-latin-wdth-normal.woff2", weight: "100 900", variable: "--font-archivo", display: "swap", declarations: [{ prop: "font-stretch", value: "62% 125%" }] });

export const metadata: Metadata = {
  title: { default: "Heimdall — The guardian layer for onchain agents", template: "%s · Heimdall" },
  description: "Transaction firewall, pay-per-call signals and Shield-guarded stock vaults for AI agents on Robinhood Chain.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://heimdall.fund"),
  alternates: { canonical: "./" },
  keywords: ["Robinhood Chain", "AI agents", "transaction firewall", "Permit2", "tokenized stocks", "vault", "USDG", "MCP"],
  openGraph: { type: "website", siteName: "Heimdall", title: "Heimdall — The guardian layer for onchain agents", description: "Transaction firewall, pay-per-call signals and Shield-guarded stock vaults for AI agents on Robinhood Chain." },
  twitter: { card: "summary_large_image", title: "Heimdall — The guardian layer for onchain agents", description: "Nothing gets signed unchecked." },
};

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://heimdall.fund";
/** Organization and site schema for search engines (no personal data). */
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": `${SITE}/#org`, name: "Heimdall", url: SITE, logo: `${SITE}/icon.svg`, description: "The guardian layer for AI agents on Robinhood Chain." },
    { "@type": "WebSite", "@id": `${SITE}/#site`, url: SITE, name: "Heimdall", publisher: { "@id": `${SITE}/#org` } },
    { "@type": "SoftwareApplication", name: "Heimdall Shield", applicationCategory: "SecurityApplication", operatingSystem: "Web", url: `${SITE}/shield`,
      description: "Transaction firewall for AI agents on Robinhood Chain: every transaction and signature is simulated and judged ALLOW, WARN or DENY before it is signed.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "1,000 free checks per wallet per day" } },
  ],
};

export const viewport = { themeColor: "#3355FF" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable} ${mono.variable} ${archivo.variable}`}>
      <body className="min-h-screen bg-paper text-ink">
        <Suspense fallback={<HeaderFallback />}><Header /></Suspense>
        <SmoothScroll />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
        <main>{children}</main>
        <Suspense fallback={null}><PageViews /></Suspense>
        <Analytics />
        <SpeedInsights />
        <Suspense fallback={null}><LiveBar /></Suspense>
        <Footer />
      </body>
    </html>
  );
}
