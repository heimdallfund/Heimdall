const t = []; let errs = 0;
for (let i = 1; i <= 25; i++) {
  const amt = (1_000_000 + i).toString(16).padStart(64, "0");
  const body = { from: "0x1111111111111111111111111111111111111111", to: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", data: "0x095ea7b3000000000000000000000000caf681a66d020601342297493863e78c959e5cb2" + amt };
  const s = performance.now();
  const r = await fetch("http://127.0.0.1:8787/v1/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await r.json(); if (!r.ok) errs++;
  t.push(performance.now() - s);
}
t.sort((a, b) => a - b);
console.log(`real RPC, 25 sequential distinct checks: p50 ${t[12].toFixed(0)} ms · p95 ${t[23].toFixed(0)} ms · max ${t[24].toFixed(0)} ms · errors ${errs}`);
