"use client";

import type { CSSProperties } from "react";

export type ClusterStreet = {
  id: string;
  name_he: string;
  lat: number;
  lng: number;
  done: boolean;
  /** Houses (addresses), apartments and voters of this cluster on the line. */
  address_count?: number;
  door_count?: number;
  voter_count?: number;
};

/** The selected cluster's streets: done checkbox, name, and a house-count badge per line. */
export function ClusterStreetList<T extends ClusterStreet>({
  streets,
  loading,
  color,
  pickedId,
  onToggleDone,
  onPick,
}: {
  streets: T[];
  loading: boolean;
  /** The cluster's color — same as its street lines and house dots. */
  color: string;
  pickedId?: string | null;
  onToggleDone: (street: T, done: boolean) => void;
  onPick: (street: T) => void;
}) {
  if (loading) return <p className="assign-empty">טוען רחובות…</p>;
  if (streets.length === 0) {
    return (
      <p className="assign-empty">
        אין רחובות מקושרים לאשכול (ממתינים לקובץ קישור). כשיופיעו — ניתן לסמן
        בוצע ליד כל שם.
      </p>
    );
  }
  const houses = streets.reduce((n, s) => n + (s.address_count ?? 0), 0);
  const done = streets.filter((s) => s.done).length;
  return (
    <>
      <p className="cluster-street-summary">
        {streets.length} רחובות · {houses.toLocaleString("he-IL")} בתים · {done} בוצעו
      </p>
      <ul
        className="cluster-street-list"
        style={{ "--cluster-color": color } as CSSProperties}
      >
        {streets.map((s) => (
          <li
            key={s.id}
            className={`cluster-street-row${s.done ? " is-done" : ""}${
              pickedId === s.id ? " is-picked" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={s.done}
              aria-label={`סמן ${s.name_he} כבוצע`}
              onChange={(e) => onToggleDone(s, e.target.checked)}
            />
            <button
              type="button"
              className="cluster-street-name"
              aria-current={pickedId === s.id ? "true" : undefined}
              onClick={() => onPick(s)}
            >
              <span className="cluster-street-title">{s.name_he}</span>
              <span className="cluster-street-meta">
                {(s.voter_count ?? 0) > 0
                  ? `${s.door_count ?? 0} דירות · ${s.voter_count} בוחרים`
                  : "אין נתוני בתים"}
              </span>
            </button>
            <span
              className="cluster-street-houses"
              title="מספר הבתים (כתובות) ברחוב באשכול"
            >
              <strong>{s.address_count ?? 0}</strong>
              <small>בתים</small>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
