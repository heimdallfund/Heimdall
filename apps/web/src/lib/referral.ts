/** The invite code from a /r/<code> link, kept in this browser only (localStorage, no cookie) until it is used. */
const KEY = "heimdall-ref";
export const saveRef = (code: string) => { try { if (/^[0-9a-z]{8}$/.test(code)) localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() })); } catch {} };
export const loadRef = (): string | null => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as { code: string; at: number } | null;
    return v && Date.now() - v.at < 30 * 86_400_000 ? v.code : null;
  } catch { return null; }
};
export const clearRef = () => { try { localStorage.removeItem(KEY); } catch {} };
export const inviteUrl = (code: string) => `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://heimdall.fund"}/r/${code}`;
export const shareOnX = (text: string, url: string) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
