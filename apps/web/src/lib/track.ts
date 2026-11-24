/** Events the Shield API accepts (anything else is dropped there). */
export type TrackEvent =
  | "pageview" | "wallet_check" | "revoke" | "report_submitted" | "stake" | "unstake" | "claim"
  | "pay_job_created" | "pay_released" | "plan_created" | "vault_deposit" | "shield_console_check" | "docs_copy" | "early_access" | "watch_on" | "token_watch_on" | "token_check";

/**
 * Privacy-friendly analytics: one anonymous counter per event and day. No cookies, no IP or wallet address is sent;
 * the server also strips addresses and ids from paths. Honours Do Not Track. Never throws.
 */
export function track(name: TrackEvent, path?: string) {
  try {
    if (typeof window === "undefined" || navigator.doNotTrack === "1") return;
    const body = JSON.stringify({ name, ...(path ? { path } : {}) });
    const url = "/api/events"; // same-origin hop to the Shield API
    if (!navigator.sendBeacon?.(url, new Blob([body], { type: "text/plain" }))) void fetch(url, { method: "POST", body, keepalive: true }).catch(() => {});
  } catch { /* analytics must never break the page */ }
}
