"use client";

import { useEffect, useState } from "react";
import { quip } from "@/lib/quips";

/** A random line from `list`, chosen after mount (server and first paint show the first line). */
export function useQuip(list: readonly string[]): string {
  const [line, setLine] = useState(list[0]!);
  useEffect(() => {
    setLine(quip(list, Math.random() * 1e9));
  }, [list]);
  return line;
}

export function Quip({ list }: { list: readonly string[] }) {
  return <>{useQuip(list)}</>;
}
