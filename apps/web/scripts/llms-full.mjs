// Builds the machine-readable docs from the Markdown in /docs (the GitBook source):
//   public/llms-full.txt     every page in SUMMARY.md order, one file an agent can read in one go
//   public/docs/<page>.md    the Markdown of each built-in docs page, next to its HTML route (llmstxt.org)
// Runs before every build. If /docs is not reachable, the committed files stay as they are.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docs = resolve(web, "../../docs");
if (!existsSync(join(docs, "SUMMARY.md"))) { console.log("llms-full: /docs not found, keeping the committed files"); process.exit(0); }

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://heimdall.fund").replace(/\/$/, "");
const map = JSON.parse(readFileSync(join(web, "docs-map.json"), "utf8"));
const fileOf = (gitbookPath) => (gitbookPath === "" ? "README.md" : `${gitbookPath.slice(1)}.md`);
const routeOf = Object.fromEntries(Object.entries(map).map(([route, gb]) => [fileOf(gb), route]));

const order = [...readFileSync(join(docs, "SUMMARY.md"), "utf8").matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1]);
const parts = [
  "# Heimdall documentation (full text)",
  "",
  `> Every page of the Heimdall docs in one file, for language models and agents. Index: ${SITE}/llms.txt. API spec: https://api.heimdall.fund/openapi.json.`,
  "",
];
let pages = 0;
for (const f of order) {
  const path = join(docs, f);
  if (!existsSync(path)) continue;
  const md = readFileSync(path, "utf8").trim();
  const route = routeOf[f];
  parts.push("---", "", `Source: ${route ? SITE + route : f}`, "", md, "");
  pages++;
  if (route) {
    const out = join(web, "public", `${route}.md`); // /docs → public/docs.md, /docs/shield → public/docs/shield.md
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${md}\n`);
  }
}
writeFileSync(join(web, "public", "llms-full.txt"), parts.join("\n"));
console.log(`llms-full: ${pages} pages`);
