/** Shields-style SVG badges with the Heimdall facet mark. Text widths are estimated for Verdana 11px. */
const FACETS = ["32,4 9,12 32,30", "32,4 55,12 32,30", "9,12 9,30 32,30", "55,12 55,30 32,30", "9,30 32,60 32,30", "55,30 32,60 32,30"];
const WHITE = ["#FFFFFF", "#D6DEFF", "#EAEFFF", "#AFC0FF", "#C7D3FF", "#9DB1FF"];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const width = (s: string) => Math.round([...s].reduce((w, ch) => w + (/[ il.,:|'!]/.test(ch) ? 3.6 : /[mwMW%]/.test(ch) ? 10 : /[A-Z0-9·]/.test(ch) ? 7.6 : 6.6), 0) + 14);

export function badgeSvg(label: string, message: string, tone: "brand" | "allow" | "muted" | "warn" | "deny" = "allow") {
  const lw = width(label) + 18, mw = width(message), w = lw + mw;
  const color = tone === "allow" ? "#0B7A3B" : tone === "brand" ? "#3355FF" : tone === "warn" ? "#A86A00" : tone === "deny" ? "#C21F32" : "#5A6377";
  const mark = FACETS.map((p, i) => `<polygon points="${p}" fill="${WHITE[i]}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(message)}">
<title>${esc(label)}: ${esc(message)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-opacity=".08"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="4" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#3355FF"/><rect x="${lw}" width="${mw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g transform="translate(5 3) scale(0.22)">${mark}</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${(lw + 18) / 2 + 1}" y="15" fill="#010101" fill-opacity=".3">${esc(label)}</text><text x="${(lw + 18) / 2}" y="14">${esc(label)}</text>
<text x="${lw + mw / 2 + 1}" y="15" fill="#010101" fill-opacity=".3">${esc(message)}</text><text x="${lw + mw / 2}" y="14">${esc(message)}</text>
</g></svg>`;
}

export const svgResponse = (svg: string, maxAge = 600) =>
  new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": `public, max-age=${maxAge}, s-maxage=${maxAge}` } });
