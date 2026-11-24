/**
 * Runs one log query per window with a small concurrency limit and one retry: public RPCs throttle bursts of wide
 * eth_getLogs calls, and a dropped window silently hides pools or positions.
 */
export async function eachWindow<T>(head: bigint, step: bigint, fn: (from: bigint, to: bigint) => Promise<T[]>, concurrency = 4, floor = 1n, stats?: { failed: number }): Promise<T[]> {
  const windows: [bigint, bigint][] = [];
  for (let to = head; to >= floor; to -= step) windows.push([to - step + 1n > floor ? to - step + 1n : floor, to]);
  const out: T[][] = new Array(windows.length);
  let next = 0;
  const worker = async () => {
    while (next < windows.length) {
      const i = next++;
      const [from, to] = windows[i]!;
      const retry = (ms: number) => () => new Promise<T[]>((r) => setTimeout(r, ms)).then(() => fn(from, to));
      out[i] = await fn(from, to).catch(retry(400)).catch(retry(1_200)).catch(() => { if (stats) stats.failed++; return []; });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, windows.length) }, worker));
  // stats.failed counts windows that failed three times: the caller decides whether a partial read is enough
  return out.flat();
}
