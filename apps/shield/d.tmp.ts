import { createPublicClient, http } from "viem";
import { SUPPORTED_CHAINS } from "./src/chains.js";
import { tokenCheck } from "./src/tokencheck.js";
const c = createPublicClient({ chain: SUPPORTED_CHAINS[4663], transport: http("https://rpc.mainnet.chain.robinhood.com", { timeout: 20000 }) });
const a = process.argv[2] as `0x${string}`;
let calls = 0; const orig = c.request; (c as any).request = (x: any, o: any) => { calls++; return orig(x, o); };
const t0 = Date.now(); const r = await tokenCheck(c as never, a); console.log(r.symbol, r.verdict, Date.now() - t0, "ms", calls, "requests", r.findings.map(f => f.code).join(","));
