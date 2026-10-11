"use client";

import { useEffect, useState } from "react";

export type FlashKind = "ok" | "err" | "info";

/** Flash banner state: success/info auto-dismiss after `ms`; errors stay until cleared. */
export function useTimedFlash(ms = 4000) {
  const [msg, setMsg] = useState<string | null>(null);
  const [kind, setKind] = useState<FlashKind>("info");

  useEffect(() => {
    if (!msg || kind === "err") return;
    const t = window.setTimeout(() => setMsg(null), ms);
    return () => window.clearTimeout(t);
  }, [msg, kind, ms]);

  function flash(nextKind: FlashKind, text: string) {
    setKind(nextKind);
    setMsg(text);
  }

  function clear() {
    setMsg(null);
  }

  return { msg, kind, flash, clear, setMsg, setKind };
}
