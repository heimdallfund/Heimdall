"use client";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-center gap-5 px-6 py-24 text-center">
      <h1 className="font-display text-[38px]">Something went wrong.</h1>
      <p className="text-muted">The page could not load, often because the Robinhood Chain RPC is slow. Your funds are not affected.</p>
      <button type="button" onClick={reset} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-white">Try again</button>
      {error.digest && <p className="font-mono text-xs text-muted">Ref {error.digest}</p>}
    </div>
  );
}
