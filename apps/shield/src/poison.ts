/**
 * Address poisoning: the attacker generates an address whose first and last characters match one the wallet
 * already uses, sends a dust or zero-value transfer so it shows up in the history, and waits for the victim to copy
 * it. Wallets show the start and the end of an address; this compares exactly what they show.
 */
const hex = (a: string) => a.toLowerCase().replace(/^0x/, "");

function sharedEnds(a: string, b: string): { head: number; tail: number } {
  const x = hex(a), y = hex(b);
  let head = 0, tail = 0;
  while (head < 40 && x[head] === y[head]) head++;
  while (tail < 40 && x[39 - tail] === y[39 - tail]) tail++;
  // Leading zeros are what gas-saving vanity contracts (Permit2, Uniswap v4) share by design, not a disguise.
  if (/^0*$/.test(x.slice(0, head))) head = 0;
  return { head, tail };
}

/**
 * The look-alike of `addr` among `known`, if any. A match needs at least 3 characters at each end and 8 in total:
 * by chance that is about 1 in 4 billion per pair, while a vanity generator finds one in minutes.
 */
export function lookalikeOf(addr: string, known: Iterable<string>): string | undefined {
  const a = hex(addr);
  for (const k of known) {
    if (hex(k) === a) continue;
    const { head, tail } = sharedEnds(addr, k);
    if (head >= 3 && tail >= 3 && head + tail >= 8) return k;
  }
  return undefined;
}
