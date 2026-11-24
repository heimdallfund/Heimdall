import type { MetadataRoute } from "next";
import { GUIDE_INDEX } from "@/lib/guideIndex";
import { DOCS_FLAT } from "@/lib/nav";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://heimdall.fund";
const paths = [
  "", "/shield", "/app/shield", "/signals", "/signals/new", "/vaults", "/vaults/new", "/agents", "/token", "/security", "/trust", "/threats", "/check", "/arena", "/pay", "/invest", "/points", "/stake", "/badges", "/early", "/status", "/brand", "/integrate", "/oracle", "/guard", "/x402", "/passport", "/changelog", "/docs/api", "/token-check",
  ...DOCS_FLAT.map((d) => d.href),
  "/legal/terms", "/legal/privacy", "/legal/risk",
  "/guides", ...GUIDE_INDEX.map((g) => `/guides/${g.slug}`),
];

export default function sitemap(): MetadataRoute.Sitemap {
  const docsExternal = Boolean(process.env.NEXT_PUBLIC_DOCS_URL);
  return paths.filter((p) => !(docsExternal && p.startsWith("/docs"))).map((p) => ({ url: `${BASE}${p}`, changeFrequency: p.startsWith("/docs") || p.startsWith("/legal") ? "monthly" : "daily", priority: p === "" ? 1 : 0.6 }));
}
