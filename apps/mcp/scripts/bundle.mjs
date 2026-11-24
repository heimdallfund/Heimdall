// Bundles the hosted handler with the Heimdall MCP server and SDK straight from their source in packages/,
// resolving their dependencies from this app's node_modules. Runs on install, so Vercel needs no custom steps
// and the function ships one self-contained file.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const pkgs = resolve(app, "../../packages");

await build({
  entryPoints: [resolve(app, "src/handler.ts")],
  outfile: resolve(app, "build/handler.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  nodePaths: [resolve(app, "node_modules")],
  alias: { "@heimdallfund/sdk": resolve(pkgs, "sdk/src/index.ts"), "@heimdallfund/mcp": resolve(pkgs, "mcp/src/index.ts") },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
console.log("bundled build/handler.mjs");
