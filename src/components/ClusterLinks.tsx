"use client";

import { useState } from "react";
import { AshkolSearch } from "@/components/AshkolSearch";
import { LinkGroup } from "@/components/LinkGroup";
import { NameSearch } from "@/components/NameSearch";
import { formatAshkolLabel } from "@/lib/ashkol-label";

type Coord = { id: number; full_name: string };

export type ClusterLinkRow = {
  ashkol: string;
  settlement_name: string;
  institution_id: number | null;
  institution_name: string;
  coordinators: Coord[];
};

async function readError(res: Response) {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || "שגיאה";
}

/** Create the first institution link for a cluster that is not in the table yet. */
export function FirstClusterLink({
  onChanged,
  onMessage,
}: {
  onChanged: () => Promise<void> | void;
  onMessage: (kind: "ok" | "err", text: string) => void;
}) {
  const [ashkol, setAshkol] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [coordinatorId, setCoordinatorId] = useState("");
  const [key, setKey] = useState(0);
  const [busy, setBusy] = useState(false);

  async function link() {
    const inst = Number(institutionId);
    const code = ashkol.trim();
    if (!Number.isInteger(inst) || inst <= 0 || !code) {
      onMessage("err", "בחרו אשכול ומוסד מהחיפוש");
      return;
    }
    setBusy(true);
    try {
      const coord = Number(coordinatorId);
      const wantCoord = Number.isInteger(coord) && coord > 0;
      if (wantCoord) {
        const coordRes = await fetch(`/api/institutions/${inst}/coordinators`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: coord }),
        });
        if (!coordRes.ok) {
          onMessage("err", await readError(coordRes));
          return;
        }
      }
      const res = await fetch(`/api/institutions/${inst}/clusters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ashkol: code }),
      });
      if (!res.ok) {
        onMessage("err", await readError(res));
        if (wantCoord) await onChanged();
        return;
      }
      setAshkol("");
      setInstitutionId("");
      setCoordinatorId("");
      setKey((k) => k + 1);
      onMessage("ok", `✓ אשכול ${code} קושר למוסד`);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-form">
      <h2 style={{ margin: 0, fontSize: "1rem" }}>קשר אשכול חדש</h2>
      <div className="link-groups cols-3">
        <label>
          אשכול
          <AshkolSearch
            key={`a-${key}`}
            disabled={busy}
            onPick={setAshkol}
          />
        </label>
        <label>
          מוסד
          <NameSearch
            key={`i-${key}`}
            endpoint="/api/institutions/search"
            placeholder="שם מוסד"
            disabled={busy}
            onPick={setInstitutionId}
          />
        </label>
        <label>
          רכז (אופציונלי)
          <NameSearch
            key={`c-${key}`}
            endpoint="/api/coordinators/search"
            placeholder="שם רכז"
            disabled={busy}
            onPick={setCoordinatorId}
          />
        </label>
      </div>
      <button
        type="button"
        className="export"
        disabled={busy || !ashkol || !institutionId}
        onClick={() => void link()}
      >
        {busy ? "…" : "קשר"}
      </button>
    </div>
  );
}

/** Institutions and coordinators for one cluster row. */
export function ClusterRowLinks({
  row,
  institutions,
  onChanged,
  onMessage,
}: {
  row: ClusterLinkRow;
  institutions: { id: number; name: string }[];
  onChanged: () => Promise<void> | void;
  onMessage: (kind: "ok" | "err", text: string) => void;
}) {
  const [instId, setInstId] = useState("");
  const [coordId, setCoordId] = useState("");
  const [key, setKey] = useState(0);
  const [busy, setBusy] = useState(false);

  async function addInstitution() {
    const id = Number(instId);
    if (!Number.isInteger(id) || id <= 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/institutions/${id}/clusters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ashkol: row.ashkol }),
      });
      if (!res.ok) {
        onMessage("err", await readError(res));
        return;
      }
      setInstId("");
      setKey((k) => k + 1);
      onMessage("ok", "המוסד קושר לאשכול");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeInstitution(id: string) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/institutions/${id}/clusters?ashkol=${encodeURIComponent(row.ashkol)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        onMessage("err", await readError(res));
        return;
      }
      onMessage("ok", "המוסד הוסר מהאשכול");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function addCoordinator() {
    const id = Number(coordId);
    if (!row.institution_id || !Number.isInteger(id) || id <= 0) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/institutions/${row.institution_id}/coordinators`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: id }),
        },
      );
      if (!res.ok) {
        onMessage("err", await readError(res));
        return;
      }
      setCoordId("");
      setKey((k) => k + 1);
      onMessage("ok", "הרכז קושר למוסד של האשכול");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeCoordinator(id: string) {
    if (!row.institution_id) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/institutions/${row.institution_id}/coordinators?user_id=${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        onMessage("err", await readError(res));
        return;
      }
      onMessage("ok", "הרכז הוסר מהמוסד");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="link-groups">
      <LinkGroup
        title={`מוסדות · ${formatAshkolLabel(row.ashkol, row.settlement_name)}`}
        chips={institutions.map((i) => ({ id: String(i.id), label: i.name }))}
        busy={busy}
        onRemove={(id) => void removeInstitution(id)}
        empty="אין מוסד"
        search={
          <>
            <NameSearch
              key={`inst-${key}`}
              endpoint="/api/institutions/search"
              placeholder="שם מוסד"
              disabled={busy}
              onPick={setInstId}
            />
            <button
              type="button"
              className="export"
              disabled={busy || !instId}
              onClick={() => void addInstitution()}
            >
              קשר
            </button>
          </>
        }
      />
      {row.institution_id ? (
        <LinkGroup
          title={`רכזים · ${row.institution_name}`}
          chips={row.coordinators.map((c) => ({
            id: String(c.id),
            label: c.full_name,
          }))}
          busy={busy}
          onRemove={(id) => void removeCoordinator(id)}
          empty="אין רכז על המוסד הזה"
          search={
            <>
              <NameSearch
                key={`coord-${key}`}
                endpoint="/api/coordinators/search"
                placeholder="שם רכז"
                disabled={busy}
                onPick={setCoordId}
              />
              <button
                type="button"
                className="export"
                disabled={busy || !coordId}
                onClick={() => void addCoordinator()}
              >
                קשר
              </button>
            </>
          }
        />
      ) : (
        <p className="lede" style={{ margin: 0 }}>
          קשרו מוסד קודם, ואז אפשר לשייך רכז.
        </p>
      )}
    </div>
  );
}
