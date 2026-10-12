"use client";

import { useState } from "react";
import { AshkolSearch } from "@/components/AshkolSearch";
import { NameSearch } from "@/components/NameSearch";
import { ShowMore } from "@/components/ShowMore";
import { formatAshkolLabel } from "@/lib/ashkol-label";
import type { CoordCluster, CoordInstitution } from "@/components/CoordClusterEditor";

type LinkRow = {
  key: string;
  institutionId: number;
  institutionName: string;
  ashkol: string | null;
  settlement: string | null;
};

async function readError(res: Response) {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || "שגיאה";
}

function buildRows(
  institutions: CoordInstitution[],
  clusters: CoordCluster[],
): LinkRow[] {
  const nameById = new Map(institutions.map((i) => [i.id, i.name]));
  const withCluster = new Set<number>();
  const rows: LinkRow[] = clusters.map((c) => {
    withCluster.add(c.institution_id);
    return {
      key: `${c.institution_id}:${c.ashkol}`,
      institutionId: c.institution_id,
      institutionName: c.institution_name || nameById.get(c.institution_id) || "",
      ashkol: c.ashkol,
      settlement: c.settlement_name ?? null,
    };
  });
  for (const inst of institutions) {
    if (withCluster.has(inst.id)) continue;
    rows.push({
      key: `${inst.id}:`,
      institutionId: inst.id,
      institutionName: inst.name,
      ashkol: null,
      settlement: null,
    });
  }
  return rows;
}

/**
 * One row per institution–cluster link for a coordinator.
 * Add, edit, and remove stay on that same row, as on the map.
 */
export function CoordinatorLinkRows({
  coordinatorId,
  institutions,
  clusters,
  onChanged,
  onMessage,
}: {
  coordinatorId: number;
  institutions: CoordInstitution[];
  clusters: CoordCluster[];
  onChanged: () => Promise<void> | void;
  onMessage: (kind: "ok" | "err", text: string) => void;
}) {
  const rows = buildRows(institutions, clusters);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [instId, setInstId] = useState("");
  const [ashkol, setAshkol] = useState("");
  const [addInstId, setAddInstId] = useState("");
  const [addAshkol, setAddAshkol] = useState("");
  const [addKey, setAddKey] = useState(0);
  const [busy, setBusy] = useState(false);

  function startEdit(row: LinkRow) {
    setEditingKey(row.key);
    setInstId(String(row.institutionId));
    setAshkol(row.ashkol ?? "");
  }

  async function linkPair(institutionId: number, code: string) {
    const coordRes = await fetch(
      `/api/institutions/${institutionId}/coordinators`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: coordinatorId }),
      },
    );
    if (!coordRes.ok) {
      onMessage("err", await readError(coordRes));
      return false;
    }
    const clusterRes = await fetch(
      `/api/institutions/${institutionId}/clusters`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ashkol: code }),
      },
    );
    if (!clusterRes.ok) {
      onMessage("err", await readError(clusterRes));
      await onChanged();
      return false;
    }
    return true;
  }

  async function unlinkCluster(institutionId: number, code: string) {
    const res = await fetch(
      `/api/institutions/${institutionId}/clusters?ashkol=${encodeURIComponent(code)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      onMessage("err", await readError(res));
      return false;
    }
    return true;
  }

  async function unlinkCoordinator(institutionId: number) {
    const res = await fetch(
      `/api/institutions/${institutionId}/coordinators?user_id=${coordinatorId}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      onMessage("err", await readError(res));
      return false;
    }
    return true;
  }

  async function add() {
    const id = Number(addInstId);
    const code = addAshkol.trim();
    if (!Number.isInteger(id) || id <= 0 || !code) {
      onMessage("err", "בחרו מוסד ואשכול מהחיפוש");
      return;
    }
    setBusy(true);
    try {
      const ok = await linkPair(id, code);
      if (!ok) return;
      setAddInstId("");
      setAddAshkol("");
      setAddKey((k) => k + 1);
      onMessage("ok", `אשכול ${code} קושר למוסד`);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function save(row: LinkRow) {
    const nextInst = Number(instId);
    const nextAsh = ashkol.trim();
    if (!Number.isInteger(nextInst) || nextInst <= 0 || !nextAsh) {
      onMessage("err", "בחרו מוסד ואשכול מהחיפוש");
      return;
    }
    if (nextInst === row.institutionId && nextAsh === row.ashkol) {
      setEditingKey(null);
      return;
    }
    setBusy(true);
    try {
      const ok = await linkPair(nextInst, nextAsh);
      if (!ok) return;
      if (row.ashkol && (nextAsh !== row.ashkol || nextInst !== row.institutionId)) {
        const removed = await unlinkCluster(row.institutionId, row.ashkol);
        if (!removed) {
          await onChanged();
          return;
        }
      }
      if (nextInst !== row.institutionId) {
        const others = rows.some(
          (r) =>
            r.institutionId === row.institutionId &&
            r.ashkol &&
            r.ashkol !== row.ashkol,
        );
        if (!others) {
          const dropped = await unlinkCoordinator(row.institutionId);
          if (!dropped) {
            await onChanged();
            return;
          }
        }
      }
      setEditingKey(null);
      onMessage("ok", "הקישור עודכן");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: LinkRow) {
    setBusy(true);
    try {
      if (row.ashkol) {
        const removed = await unlinkCluster(row.institutionId, row.ashkol);
        if (!removed) return;
        const others = rows.some(
          (r) =>
            r.institutionId === row.institutionId &&
            r.ashkol &&
            r.ashkol !== row.ashkol,
        );
        if (!others) {
          const dropped = await unlinkCoordinator(row.institutionId);
          if (!dropped) {
            await onChanged();
            return;
          }
        }
        onMessage("ok", `הקישור לאשכול ${row.ashkol} הוסר`);
      } else {
        const dropped = await unlinkCoordinator(row.institutionId);
        if (!dropped) return;
        onMessage("ok", "הקישור למוסד הוסר");
      }
      if (editingKey === row.key) setEditingKey(null);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="coord-link-rows">
      <h3>קישורי מוסד ואשכול</h3>
      {rows.length === 0 ? (
        <p className="lede" style={{ margin: 0 }}>
          אין קישורים — בחרו מוסד ואשכול ביחד.
        </p>
      ) : (
        <ul className="coord-link-list">
          {rows.map((row) =>
            editingKey === row.key ? (
              <li key={row.key} className="coord-link-line coord-link-line-edit">
                <label>
                  מוסד
                  <NameSearch
                    key={`inst-${row.key}`}
                    endpoint="/api/institutions/search"
                    placeholder="שם מוסד"
                    disabled={busy}
                    initialLabel={row.institutionName}
                    onPick={setInstId}
                  />
                </label>
                <label>
                  אשכול
                  <AshkolSearch
                    key={`ash-${row.key}`}
                    disabled={busy}
                    initialAshkol={row.ashkol ?? ""}
                    initialSettlement={row.settlement}
                    onPick={setAshkol}
                  />
                </label>
                <button
                  type="button"
                  className="export"
                  disabled={busy || !instId || !ashkol.trim()}
                  onClick={() => void save(row)}
                >
                  {busy ? "…" : "שמור"}
                </button>
                <button
                  type="button"
                  className="reset"
                  disabled={busy}
                  onClick={() => setEditingKey(null)}
                >
                  ביטול
                </button>
              </li>
            ) : (
              <li key={row.key} className="coord-link-line">
                <span className="coord-link-part">
                  <span className="coord-link-k">מוסד</span>
                  <ShowMore text={row.institutionName} />
                </span>
                <span className="coord-link-part">
                  <span className="coord-link-k">אשכול</span>
                  {row.ashkol ? (
                    <ShowMore
                      text={formatAshkolLabel(row.ashkol, row.settlement)}
                    />
                  ) : (
                    <span className="muted-cell">אין אשכול</span>
                  )}
                </span>
                <button
                  type="button"
                  className="export"
                  disabled={busy}
                  onClick={() => startEdit(row)}
                >
                  ערוך
                </button>
                <button
                  type="button"
                  className="reset"
                  disabled={busy}
                  onClick={() => void remove(row)}
                >
                  הסר
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      <div className="coord-link-line coord-link-line-edit">
        <label>
          מוסד
          <NameSearch
            key={`add-inst-${addKey}`}
            endpoint="/api/institutions/search"
            placeholder="שם מוסד"
            disabled={busy}
            onPick={setAddInstId}
          />
        </label>
        <label>
          אשכול
          <AshkolSearch
            key={`add-ash-${addKey}`}
            disabled={busy}
            onPick={setAddAshkol}
            onSubmit={() => void add()}
          />
        </label>
        <button
          type="button"
          className="export"
          disabled={busy || !addInstId || !addAshkol.trim()}
          onClick={() => void add()}
        >
          {busy ? "…" : "קשר"}
        </button>
      </div>
    </div>
  );
}
