"use client";
import { useMemo, useState } from "react";
import { SnippetCopy } from "@/components/SnippetCopy";

const EXAMPLE = "0x066141bb21ef5a6c754825c05617ac59c5c55f75";

function Code({ title, code }: { title: string; code: string }) {
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-[3px] bg-ink">
      <div className="flex items-center justify-between border-b border-paper/10 px-4 py-2"><span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-paper/60">{title}</span><SnippetCopy text={code} /></div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed text-paper"><code>{code}</code></pre>
    </div>
  );
}

/** Pick a token and a theme, see the live card and badge, copy the snippet. */
export function WidgetBuilder({ site }: { site: string }) {
  const [input, setInput] = useState(EXAMPLE);
  const [dark, setDark] = useState(false);
  const token = /^0x[0-9a-fA-F]{40}$/.test(input.trim()) ? input.trim() : EXAMPLE;
  const snippets = useMemo(() => ({
    script: `<div data-heimdall-token="${token}"${dark ? ` data-theme="dark"` : ""}></div>\n<script src="${site}/embed.js" async></script>`,
    iframe: `<iframe src="${site}/embed/token/${token}${dark ? "?theme=dark" : ""}" width="420" height="200" style="border:0" loading="lazy" title="Heimdall Token Check"></iframe>`,
    badge: `<a href="${site}/token-check/${token}"><img src="${site}/badge/token/${token}" alt="Heimdall Token Check" height="20"></a>`,
    markdown: `[![Heimdall Token Check](${site}/badge/token/${token})](${site}/token-check/${token})`,
    api: `GET https://api.heimdall.fund/v1/token/${token}`,
  }), [token, dark, site]);
  return (
    <section className="grid gap-6 lg:grid-cols-[440px_1fr]">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="label">Token address</span>
          <input value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} className="min-h-11 border-2 border-ink bg-panel px-3 font-mono text-[13px] outline-none focus:border-brand" placeholder="0x…" />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setDark(false)} className={`border-2 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] ${!dark ? "border-ink bg-ink text-paper" : "border-line text-muted"}`}>Light</button>
          <button type="button" onClick={() => setDark(true)} className={`border-2 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] ${dark ? "border-ink bg-ink text-paper" : "border-line text-muted"}`}>Dark</button>
        </div>
        <div className={`flex flex-col gap-3 p-4 ${dark ? "bg-[#0B0D11]" : "bg-ice"}`}>
          <span className={`label ${dark ? "text-paper/60" : ""}`}>Live card</span>
          <iframe key={`${token}-${dark}`} src={`/embed/token/${token}${dark ? "?theme=dark" : ""}`} title="Token Check card preview" className="h-[210px] w-full border-0" />
          <span className={`label ${dark ? "text-paper/60" : ""}`}>Live badge</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={`b-${token}`} src={`/badge/token/${token}`} alt="Token Check badge preview" height={20} className="self-start" />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Code title="Card · two lines, sizes itself" code={snippets.script} />
        <Code title="Card · plain iframe" code={snippets.iframe} />
        <Code title="Badge · HTML" code={snippets.badge} />
        <Code title="Badge · Markdown" code={snippets.markdown} />
        <Code title="API · build your own" code={snippets.api} />
        <p className="text-[13px] text-muted">On a single-page app, call <code className="font-mono">HeimdallTokenCheck.scan()</code> after rendering a new token, or let the script pick up new <code className="font-mono">data-heimdall-token</code> elements by itself.</p>
      </div>
    </section>
  );
}
