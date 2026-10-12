"use client";

import { useState } from "react";
import { LinkGroup } from "@/components/LinkGroup";
import { NameSearch } from "@/components/NameSearch";

async function readError(res: Response) {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || "שגיאה";
}

/** Link or unlink institutions for one coordinator. */
export function CoordinatorInstitutionLinks({
  coordinatorId,
  institutions,
  onChanged,
  onMessage,
}: {
  coordinatorId: number;
  institutions: { id: number; name: string }[];
  onChanged: () => Promise<void> | void;
  onMessage: (kind: "ok" | "err", text: string) => void;
}) {
  const [instId, setInstId] = useState("");
  const [key, setKey] = useState(0);
  const [busy, setBusy] = useState(false);

  async function add() {
    const id = Number(instId);
    if (!Number.isInteger(id) || id <= 0) {
      onMessage("err", "בחרו מוסד מהחיפוש");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/institutions/${id}/coordinators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: coordinatorId }),
      });
      if (!res.ok) {
        onMessage("err", await readError(res));
        return;
      }
      setInstId("");
      setKey((k) => k + 1);
      onMessage("ok", "✓ המוסד קושר לרכז");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/institutions/${id}/coordinators?user_id=${coordinatorId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        onMessage("err", await readError(res));
        return;
      }
      onMessage("ok", "המוסד הוסר מהרכז");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <LinkGroup
      title="מוסדות"
      chips={institutions.map((i) => ({ id: String(i.id), label: i.name }))}
      busy={busy}
      onRemove={(id) => void remove(id)}
      empty="אין מוסד — קשרו מוסד לפני אשכול"
      search={
        <>
          <NameSearch
            key={key}
            endpoint="/api/institutions/search"
            placeholder="שם מוסד"
            disabled={busy}
            onPick={setInstId}
          />
          <button
            type="button"
            className="export"
            disabled={busy || !instId}
            onClick={() => void add()}
          >
            קשר
          </button>
        </>
      }
    />
  );
}
