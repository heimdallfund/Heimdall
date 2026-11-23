// Caching JSON-RPC proxy: first request goes to the real Robinhood Chain RPC, identical ones are served from memory.
// Lets a load test measure Shield's own overhead without hammering the public RPC.
import { createServer } from "node:http";
const UP = "https://rpc.mainnet.chain.robinhood.com";
const cache = new Map(); let hits = 0, miss = 0;
const one = async (r) => {
  const key = r.method === "eth_blockNumber" ? "bn" : JSON.stringify([r.method, r.params]);
  if (!cache.has(key)) { miss++; cache.set(key, fetch(UP, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...r, id: 1 }) }).then((x) => x.json())); } else hits++;
  const res = await cache.get(key); return { ...res, id: r.id };
};
createServer(async (req, res) => {
  if (req.url === "/stats") { res.end(JSON.stringify({ hits, miss })); return; }
  let b = ""; for await (const c of req) b += c;
  const j = JSON.parse(b);
  const out = Array.isArray(j) ? await Promise.all(j.map(one)) : await one(j);
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
}).listen(8599, () => console.log("rpc cache on 8599"));
