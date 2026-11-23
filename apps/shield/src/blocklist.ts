import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Known-bad addresses (drainers, phishing contracts, exploiters).
 * Sources: data/blocklist.json in the repo + SHIELD_BLOCKLIST (comma-separated) at runtime.
 */
let cache: Set<string> | undefined;

function load(): Set<string> {
  const set = new Set<string>();
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = JSON.parse(readFileSync(join(here, "..", "data", "blocklist.json"), "utf8")) as { address: string }[];
    for (const e of raw) if (e?.address) set.add(e.address.toLowerCase());
  } catch { /* no file: empty list */ }
  for (const a of (process.env.SHIELD_BLOCKLIST ?? "").split(",")) if (a.trim()) set.add(a.trim().toLowerCase());
  return set;
}

export function isBlocklisted(address?: string | null): boolean {
  if (!address) return false;
  cache ??= load();
  return cache.has(address.toLowerCase());
}

/** Test hook. */
export function resetBlocklist() {
  cache = undefined;
}

export interface BlocklistEntry { address: string; label?: string; source?: string; addedAt?: string }

/** Public list for the Threat Board (labels from data/blocklist.json; runtime additions are unlabeled). */
export function blocklistEntries(): BlocklistEntry[] {
  const out = new Map<string, BlocklistEntry>();
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = JSON.parse(readFileSync(join(here, "..", "data", "blocklist.json"), "utf8")) as BlocklistEntry[];
    for (const e of raw) if (e?.address) out.set(e.address.toLowerCase(), e);
  } catch { /* none */ }
  for (const a of (process.env.SHIELD_BLOCKLIST ?? "").split(",")) if (a.trim() && !out.has(a.trim().toLowerCase())) out.set(a.trim().toLowerCase(), { address: a.trim(), source: "runtime" });
  for (const a of community) if (!out.has(a)) out.set(a, { address: a, label: "Community report", source: "Guardian report" });
  return [...out.values()];
}

/** Community-confirmed addresses (drainer reports), added at runtime and loaded from the store at startup. */
const community = new Set<string>();
export function addCommunityBlock(address: string) {
  const a = address.toLowerCase();
  community.add(a);
  cache ??= load();
  cache.add(a);
}
/** Undo a community block (a wrong report). Addresses on the curated list stay blocked. */
export function removeCommunityBlock(address: string): boolean {
  const a = address.toLowerCase();
  if (!community.delete(a)) return false;
  if (!load().has(a)) cache?.delete(a);
  return true;
}
export function communityEntries(): BlocklistEntry[] {
  return [...community].map((address) => ({ address, label: "Community report", source: "Guardian report" }));
}
