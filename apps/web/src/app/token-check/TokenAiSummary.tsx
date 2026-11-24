"use client";
import { useEffect, useState } from "react";

/** The AI's plain-words reading of the report. Written from the checks only; the verdict above stays Heimdall's. */
export function TokenAiSummary({ address }: { address: string }) {
  const [state, setState] = useState<{ text: string | null; done: boolean }>({ text: null, done: false });
  useEffect(() => {
    let live = true;
    fetch(`/api/token-summary/${address}`).then((r) => r.json()).then((j) => { if (live) setState({ text: j.summary ?? null, done: true }); }).catch(() => live && setState({ text: null, done: true }));
    return () => { live = false; };
  }, [address]);
  if (state.done && !state.text) return null;
  const [body, bottom] = (state.text ?? "").split(/\n?Bottom line:\s*/i);
  return (
    <section className="card flex flex-col gap-2 border-brand/30 p-5" aria-live="polite">
      <span className="label flex items-center gap-2"><span className="inline-block size-2 rounded-full bg-brand" />In plain words · AI</span>
      {!state.done ? (
        <div className="flex flex-col gap-2" aria-label="Writing a summary"><div className="h-3.5 w-11/12 animate-pulse rounded bg-ink-2" /><div className="h-3.5 w-9/12 animate-pulse rounded bg-ink-2" /><div className="h-3.5 w-7/12 animate-pulse rounded bg-ink-2" /></div>
      ) : (
        <>
          <p className="text-[15.5px] leading-relaxed">{body.trim()}</p>
          {bottom && <p className="text-[15.5px] font-semibold leading-relaxed">Bottom line: {bottom.trim()}</p>}
          <p className="text-[12px] text-muted">Written by AI from the checks on this page, nothing else. The verdict is Heimdall&apos;s simulation, not the AI&apos;s opinion.</p>
        </>
      )}
    </section>
  );
}
