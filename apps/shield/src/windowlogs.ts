/**
 * Runs one log query per window with a small concurrency limit and one retry: public RPCs throttle bursts of wide
 * eth_getLogs calls, and a dropped window silently hides pools or positions.
 */
export async function eachWindow<T>(head: bigint, step: bigint, fn: (from: bigint, to: bigint) => Promise<T[]>, concurrency = 4, floor = 1n, strict = false): Promise<T[]> {
  const windows: [bigint, bigint][] = [];
  for (let to = head; to >= floor; to -= step) windows.push([to - step + 1n > floor ? to - step + 1n : floor, to]);
  const out: T[][] = new Array(windows.length);
  let next = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (next < windows.length) {
      const i = next++;
      const [from, to] = windows[i]!;
      out[i] = await fn(from, to).catch(() => new Promise<T[]>((r) => setTimeout(r, 400)).then(() => fn(from, to)).catch((e) => { if (strict) failed = e; return []; }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, windows.length) }, worker));
  // strict: a window that failed twice makes the whole read fail, so a missing result is never taken as "none"
  if (strict && failed) throw failed;
  return out.flat();
}
