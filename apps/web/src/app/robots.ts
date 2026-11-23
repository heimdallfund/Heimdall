import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://heimdall.fund";
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/app/keys", "/admin"] }], sitemap: `${base}/sitemap.xml` };
}
