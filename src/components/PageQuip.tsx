"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { PAGE_QUIPS } from "@/lib/quips";

const NONE: readonly string[] = [];
const EVERY_MS = 12000;

/**
 * A short line under the page title. Starts on a random line and moves to the next
 * every 12 seconds with a soft fade, so the page shows its whole set over time.
 * With reduced motion the line stays put.
 */
export function PageQuip() {
  const path = usePathname();
  const list = PAGE_QUIPS[path] ?? NONE;
  const [i, setI] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (list.length === 0) return;
    setI(Math.floor(Math.random() * list.length));
    if (list.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let fadeTimer: number | undefined;
    const t = window.setInterval(() => {
      setFading(true);
      fadeTimer = window.setTimeout(() => {
        setI((cur) => (cur + 1) % list.length);
        setFading(false);
      }, 350);
    }, EVERY_MS);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(fadeTimer);
    };
  }, [list]);

  if (list.length === 0) return null;
  return (
    <p className={fading ? "page-quip is-fading" : "page-quip"} aria-live="off">
      {list[i % list.length]}
    </p>
  );
}
