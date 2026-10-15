"use client";

import { useEffect, useState } from "react";

/**
 * Two-step delete: the first tap arms the button ("בטוח? מחיקה"), the second deletes.
 * Disarms by itself after 4 seconds. No browser dialog.
 */
export function ConfirmDelete({
  onConfirm,
  disabled,
  label = "מחיקה",
}: {
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  label?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      className={armed ? "row-btn row-btn-danger is-armed" : "row-btn row-btn-danger"}
      disabled={disabled || busy}
      aria-live="polite"
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
    >
      {busy ? "מוחק…" : armed ? `בטוח? ${label}` : label}
    </button>
  );
}
