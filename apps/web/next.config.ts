import type { NextConfig } from "next";

// Docs live on GitBook once NEXT_PUBLIC_DOCS_URL is set (e.g. https://docs.heimdall.fund);
// until then the built-in /docs pages are served. Old /docs links keep working either way.
const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL?.replace(/\/$/, "");
const DOCS_MAP: Record<string, string> = {
  "/docs": "", "/docs/limits": "/limits", "/docs/shield": "/shield/transactions", "/docs/signatures": "/shield/signatures",
  "/docs/vaults": "/products/vaults", "/docs/signals": "/products/signals", "/docs/agent": "/products/agent",
  "/docs/sdk": "/build/sdk", "/docs/mcp": "/build/mcp", "/docs/frameworks": "/build/agent-frameworks", "/docs/contracts": "/build/contracts",
  "/docs/webhooks": "/shield/webhooks", "/docs/wallet-check": "/products/wallet-check", "/docs/pay": "/products/pay", "/docs/auto-invest": "/products/auto-invest",
  "/docs/arena": "/products/arena", "/docs/points": "/products/points", "/docs/staking": "/products/staking",
};

const nextConfig: NextConfig = {
  // e2e/run.sh builds into its own folder so a fork build never replaces the real one
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async redirects() {
    if (!DOCS_URL) return [];
    return Object.entries(DOCS_MAP).map(([source, path]) => ({ source, destination: `${DOCS_URL}${path}`, permanent: false }));
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
