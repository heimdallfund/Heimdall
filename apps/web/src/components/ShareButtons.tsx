"use client";
import { useState } from "react";

export function ShareButtons({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <a href={`https://x.com/intent/post?text=${encodeURIComponent(text)}`}
        onClick={(e) => { e.currentTarget.href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.href)}`; }}
        target="_blank" rel="noreferrer" className="btn btn-secondary">Share on X</a>
      <button type="button" className="btn btn-secondary" onClick={async () => { try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>{copied ? "Link copied" : "Copy link"}</button>
    </div>
  );
}
