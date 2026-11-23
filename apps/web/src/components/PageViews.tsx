"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/track";

/** Counts a page view per route change (path only; see lib/track.ts). Admin pages are not counted. */
export function PageViews() {
  const path = usePathname();
  useEffect(() => { if (path && !path.startsWith("/admin")) track("pageview", path); }, [path]);
  return null;
}
