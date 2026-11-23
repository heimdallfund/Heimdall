"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

function useInView<T extends Element>(once = true) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); if (once) io.disconnect(); } }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [once]);
  return [ref, inView] as const;
}

/** Headline that rises in word by word. Words are real text, so it reads fine without JS. */
export function Words({ text, className = "", accent }: { text: string; className?: string; accent?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  const words = text.split(" ");
  const accentWords = accent ? accent.split(" ") : [];
  return (
    <span ref={ref} className={`words ${inView ? "in" : ""} ${className}`} aria-label={text}>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span aria-hidden="true" className="word-wrap"><span className={`word ${accentWords.includes(w.replace(/[.,]/g, "")) ? "text-brand" : ""}`} style={{ transitionDelay: `${i * 45}ms` }}>{w}</span></span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </span>
  );
}

/** Counts up to `to` once visible. */
export function CountUp({ to, suffix = "", decimals = 0, className = "" }: { to: number; suffix?: string; decimals?: number; className?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  const [v, setV] = useState(to);
  useEffect(() => {
    if (!inView || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / 1400);
      setV(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    setV(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, to]);
  return <span ref={ref} className={className}>{v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}

/** Card with a soft light that follows the cursor. */
export function Spotlight({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`spotlight ${className}`}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--x", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--y", `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </div>
  );
}
