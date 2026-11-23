/**
 * Alert webhook. Works with Discord, Slack and ntfy.sh webhooks (the payload shape is picked from the URL);
 * any other URL receives JSON { text }. Falls back to stdout when no webhook is configured.
 */
export function webhook(url?: string, fetcher: typeof fetch = fetch) {
  return async (text: string) => {
    if (!url) { console.log(text); return; }
    const host = new URL(url).hostname;
    const init: RequestInit = host.endsWith("ntfy.sh")
      ? { method: "POST", body: text, headers: { title: "Heimdall monitor" } }
      : { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(host.includes("discord") ? { content: text.slice(0, 1900), allowed_mentions: { parse: [] } } : { text }) };
    const res = await fetcher(url, init);
    if (!res.ok) console.error("alert webhook error", res.status, await res.text().catch(() => ""));
  };
}
