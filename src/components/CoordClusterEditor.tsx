"use client";

import { useEffect, useState } from "react";
import { AshkolSearch } from "@/components/AshkolSearch";
import { ShowMore } from "@/components/ShowMore";
import { formatAshkolLabel } from "@/lib/ashkol-label";

export type CoordInstitution = {
  id: number;
  name: string;
  settlement_name?: string | null;
};

export type CoordCluster = {
  ashkol: string;
  settlement_name?: string | null;
  institution_id: number;
  institution_name?: string;
};

type Props = {
  institutions: CoordInstitution[];
  clusters: CoordCluster[];
  onChanged: () => Promise<void> | void;
  onMessage?: (kind: "ok" | "err", text: string) => void;
};

/**
 * Add / remove ashkol links for a coordinator via their institutions.
 * The linked list lives only here so the table summary is hidden while editing.
 */
export function CoordClusterEditor({
  institutions,
  clusters,
  onChanged,
  onMessage,
}: Props) {
  const [institutionId, setInstitutionId] = useState(
    institutions[0] ? String(institutions[0].id) : "",
  );
  const [ashkol, setAshkol] = useState("");
  const [pickerKey, setPickerKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setInstitutionId((cur) => {
      if (institutions.some((i) => String(i.id) === cur)) return cur;
      return institutions[0] ? String(institutions[0].id) : "";
    });
  }, [institutions]);

  if (institutions.length === 0) {
    return (
      <p className="lede" style={{ margin: 0 }}>
        אין מוסדות משויכים לרכז — קשרו מוסד לפני הוספת אשכולות.
      </p>
    );
  }

  async function link() {
    const id = Number(institutionId);
    const code = ashkol.trim();
    if (!Number.isInteger(id) || id <= 0 || !code) {
      onMessage?.("err", "בחרו מוסד ואשכול מהחיפוש");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/institutions/${id}/clusters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ashkol: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        onMessage?.("err", data.error || "שגיאה בקישור אשכול");
        return;
      }
      setAshkol("");
      setPickerKey((k) => k + 1);
      onMessage?.("ok", `✓ אשכול ${code} נוסף`);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function unlink(c: CoordCluster) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/institutions/${c.institution_id}/clusters?ashkol=${encodeURIComponent(c.ashkol)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) {
        onMessage?.("err", data.error || "שגיאה בהסרת אשכול");
        return;
      }
      onMessage?.("ok", `אשכול ${c.ashkol} הוסר`);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="coord-cluster-editor">
      {clusters.length > 0 ? (
        <ul className="coord-cluster-list">
          {clusters.map((c) => (
            <li key={`${c.institution_id}:${c.ashkol}`}>
              <ShowMore text={formatAshkolLabel(c.ashkol, c.settlement_name)} />
              {institutions.length > 1 && c.institution_name ? (
                <span className="muted-cell">
                  · <ShowMore text={c.institution_name} />
                </span>
              ) : null}
              <button
                type="button"
                className="reset"
                disabled={busy}
                onClick={() => void unlink(c)}
              >
                הסר
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lede" style={{ margin: 0 }}>
          אין אשכולות מקושרים
        </p>
      )}
      <div className="coord-cluster-add">
        <label>
          מוסד
          <select
            value={institutionId}
            onChange={(e) => setInstitutionId(e.target.value)}
            disabled={busy}
          >
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          אשכול
          <AshkolSearch
            key={pickerKey}
            disabled={busy}
            onPick={setAshkol}
            onSubmit={() => void link()}
          />
        </label>
        <button
          type="button"
          className="export"
          disabled={busy || !ashkol.trim()}
          onClick={() => void link()}
        >
          {busy ? "…" : "הוסף אשכול"}
        </button>
      </div>
    </div>
  );
}
