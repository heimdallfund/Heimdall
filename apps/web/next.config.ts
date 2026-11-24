import type { NextConfig } from "next";
import docsMap from "./docs-map.json" with { type: "json" };

// Docs live on GitBook once NEXT_PUBLIC_DOCS_URL is set (e.g. https://docs.heimdall.fund);
// until then the built-in /docs pages are served. Old /docs links keep working either way.
const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL?.replace(/\/$/, "");
// Built-in docs route → GitBook path (and docs/*.md file). Shared with scripts/llms-full.mjs.
const DOCS_MAP: Record<string, string> = docsMap;

const nextConfig: NextConfig = {
  // e2e/run.sh builds into its own folder so a fork build never replaces the real one
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async redirects() {
    if (!DOCS_URL) return [];
    return [
      ...Object.entries(DOCS_MAP).map(([source, path]) => ({ source, destination: `${DOCS_URL}${path}`, permanent: false })),
      // any docs page not in the map lands on the GitBook home instead of a 404
      // (the API reference stays here: it is generated from the live OpenAPI spec)
      { source: "/docs/:path((?!api$).+)", destination: DOCS_URL, permanent: false },
    ];
  },
  async headers() {
    // discovery files are public metadata: any origin may read them
    const open = [{ key: "access-control-allow-origin", value: "*" }, { key: "cache-control", value: "public, max-age=3600" }];
    return [
      { source: "/.well-known/mcp/server-card.json", headers: open },
      { source: "/.well-known/agent-card.json", headers: open },
      { source: "/llms.txt", headers: open },
      { source: "/llms-full.txt", headers: open },
      { source: "/docs/:page*.md", headers: [...open, { key: "content-type", value: "text/markdown; charset=utf-8" }] },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
