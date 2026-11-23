"use client";
import { useEffect, useRef, useState } from "react";

/** 0 → 1 as a tall section scrolls through the viewport (for pinned / sticky storytelling). */
export function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const total = r.height - window.innerHeight;
        const v = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
        setP((old) => (Math.abs(old - v) > 0.0005 ? v : old));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return [ref, p] as const;
}
