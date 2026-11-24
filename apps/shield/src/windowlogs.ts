/**
 * Runs one log query per window with a small concurrency limit and one retry: public RPCs throttle bursts of wide
 * eth_getLogs calls, and a dropped window silently hides pools or positions.
 */
export async function eachWindow<T>(head: bigint, step: bigint, fn: (from: bigint, to: bigint) => Promise<T[]>, concurrency = 4): Promise<T[]> {
  const windows: [bigint, bigint][] = [];
  for (let to = head; to > 0n; to -= step) windows.push([to - step + 1n > 1n ? to - step + 1n : 1n, to]);
  const out: T[][] = new Array(windows.length);
  let next = 0;
  const worker = async () => {
    while (next < windows.length) {
      const i = next++;
      const [from, to] = windows[i]!;
      out[i] = await fn(from, to).catch(() => new Promise<T[]>((r) => setTimeout(r, 400)).then(() => fn(from, to)).catch(() => []));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, windows.length) }, worker));
  return out.flat();
}
