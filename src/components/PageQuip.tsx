"use client";

import { usePathname } from "next/navigation";
import { PAGE_QUIPS } from "@/lib/quips";
import { useQuip } from "@/components/Quip";

const NONE: readonly string[] = [""];

/** A short line under the page title, picked once per visit. */
export function PageQuip() {
  const path = usePathname();
  const line = useQuip(PAGE_QUIPS[path] ?? NONE);
  if (!line) return null;
  return <p className="page-quip">{line}</p>;
}
