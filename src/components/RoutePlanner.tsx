"use client";

import { useEffect, useRef, useState } from "react";
import type { Feature, LineString } from "geojson";
import type { RouteStage } from "@/lib/cluster-route-types";
import { directedGeometry } from "@/lib/street-span";

/** Stage colors stay off blue, green, gold, cyan, orange, red, and near-black. */
const STAGE_COLORS = ["#7c3aed", "#db2777", "#d946ef", "#c084fc", "#f472b6", "#e879f9"];

function pointName(stageNo: number) {
  return stageNo === 1 ? "נקודת התחלה" : "נקודת איסוף";
}

export function stageColor(stageNo: number) {
  return STAGE_COLORS[(Math.max(stageNo, 1) - 1) % STAGE_COLORS.length]!;
}

function FilterMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 5 H20 L14 12 V19 L10 17 V12 Z" fill="currentColor" />
    </svg>
  );
}

function DirMark({ flip = false }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={flip ? "route-icon-flip" : undefined}>
      <path d="M12 3 L19 19 L12 15 L5 19 Z" fill="currentColor" />
    </svg>
  );
}

export type RouteMode = "off" | "street" | "point";

type StreetPick = {
  id: string;
  name_he: string;
  from_ratio?: number;
  to_ratio?: number;
  reversed?: boolean;
};

export type RouteApi = {
  addStreet: (street: StreetPick) => void;
  addStreetToStage: (street: StreetPick, stageNo: number) => void;
  addStreetToNewStage: (street: StreetPick) => void;
  addPoint: (lat: number, lng: number) => void;
  addStartPoint: (lat: number, lng: number) => void;
  setStagePoint: (stageNo: number, lat: number, lng: number) => void;
  addCollectionPoint: (lat: number, lng: number) => void;
};

function toFeatures(stages: RouteStage[]): Feature[] {
  const features: Feature[] = [];
  for (const stage of stages) {
    const color = stageColor(stage.stage_no);
    for (const street of stage.streets) {
      const geometry = directedGeometry(street.geometry, street.reversed);
      if (!geometry) continue;
      const lines =
        geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
      for (const coordinates of lines) {
        if (coordinates.length < 2) continue;
        const line: Feature<LineString> = {
          type: "Feature",
          properties: {
            color,
            stage: stage.stage_no,
            kind: "street",
            id: street.street_id,
            name_he: street.name_he,
            span: Math.max(0.05, (street.to_ratio ?? 1) - (street.from_ratio ?? 0)),
          },
          geometry: { type: "LineString", coordinates },
        };
        features.push(line);
      }
    }
    if (stage.point) {
      const collectNo = stages.filter((item) => item.stage_no > 1 && item.stage_no <= stage.stage_no && item.point).length;
      features.push({
        type: "Feature",
        properties: {
          color,
          stage: stage.stage_no,
          kind: "point",
          label: stage.stage_no === 1 ? "התחלה" : `איסוף ${collectNo}`,
        },
        geometry: {
          type: "Point",
          coordinates: [stage.point.lng, stage.point.lat],
        },
      });
    }
  }
  return features;
}

function payload(stages: RouteStage[]) {
  return {
    stages: stages.map((stage) => ({
      streets: stage.streets.map((s) => ({
        street_id: s.street_id,
        note: s.note,
        from_ratio: s.from_ratio ?? 0,
        to_ratio: s.to_ratio ?? 1,
        reversed: Boolean(s.reversed),
        done: Boolean(s.done),
      })),
      point: stage.point
        ? { lat: stage.point.lat, lng: stage.point.lng, note: stage.point.note }
        : null,
    })),
  };
}

export function RoutePlanner({
  ashkol,
  mode: _mode,
  onMode,
  onFeatures,
  onStages,
  bindRef,
}: {
  ashkol: string;
  mode: RouteMode;
  onMode: (mode: RouteMode) => void;
  onFeatures: (features: Feature[]) => void;
  onStages: (
    stages: {
      stage_no: number;
      hasPoint: boolean;
      streets: { street_id: string; reversed: boolean; from_ratio: number; to_ratio: number }[];
    }[],
  ) => void;
  bindRef: React.MutableRefObject<RouteApi | null>;
}) {
  const [stages, setStages] = useState<RouteStage[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<number | "all">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [openStage, setOpenStage] = useState<number | null>(null);
  const [noteEdit, setNoteEdit] = useState<
    | { kind: "street"; stageNo: number; streetId: string; title: string }
    | { kind: "point"; stageNo: number; title: string }
    | null
  >(null);
  const stagesRef = useRef(stages);
  const activeRef = useRef(active);
  const ashkolRef = useRef(ashkol);
  const ticket = useRef(0);
  const onFeaturesRef = useRef(onFeatures);
  const onStagesRef = useRef(onStages);
  stagesRef.current = stages;
  activeRef.current = active;
  ashkolRef.current = ashkol;
  onFeaturesRef.current = onFeatures;
  onStagesRef.current = onStages;

  useEffect(() => {
    const shown =
      stageFilter === "all" ? stages : stages.filter((stage) => stage.stage_no === stageFilter);
    onFeaturesRef.current(toFeatures(shown));
    onStagesRef.current(
      stages.map((stage) => ({
        stage_no: stage.stage_no,
        hasPoint: Boolean(stage.point),
        streets: stage.streets.map((street) => ({
          street_id: street.street_id,
          reversed: Boolean(street.reversed),
          from_ratio: street.from_ratio ?? 0,
          to_ratio: street.to_ratio ?? 1,
        })),
      })),
    );
  }, [stages, stageFilter]);

  useEffect(() => {
    let cancelled = false;
    const my = ++ticket.current;
    setLoading(true);
    setError(null);
    fetch(`/api/clusters/${encodeURIComponent(ashkol)}/route`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "שגיאה");
        return (data.stages ?? []) as RouteStage[];
      })
      .then((next) => {
        if (cancelled || my !== ticket.current) return;
        stagesRef.current = next;
        setStages(next);
        setActive(next[0]?.stage_no ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "שגיאה");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      onFeaturesRef.current([]);
    };
  }, [ashkol]);

  async function persist(next: RouteStage[]) {
    const savedFor = ashkol;
    const my = ++ticket.current;
    stagesRef.current = next;
    setStages(next);
    const res = await fetch(`/api/clusters/${encodeURIComponent(savedFor)}/route`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload(next)),
    });
    const data = await res.json().catch(() => ({}));
    if (my !== ticket.current || savedFor !== ashkolRef.current) return;
    if (!res.ok) {
      setError(data.error || "שגיאה בשמירת המסלול");
      return;
    }
    setError(null);
    const saved = (data.stages ?? []) as RouteStage[];
    stagesRef.current = saved;
    setStages(saved);
  }

  function withStage(stageNo: number | null) {
    const prev = stagesRef.current;
    if (prev.length === 0) {
      return { stages: [{ stage_no: 1, streets: [], point: null }], stageNo: 1 };
    }
    const no = stageNo && prev.some((s) => s.stage_no === stageNo)
      ? stageNo
      : prev[prev.length - 1]!.stage_no;
    return { stages: prev, stageNo: no };
  }

  function placeStreet(street: StreetPick, stageNo: number, baseStages: RouteStage[]) {
    let note = "";
    let reversed = false;
    let done = false;
    let geometry: RouteStage["streets"][number]["geometry"] = null;
    for (const stage of baseStages) {
      const found = stage.streets.find((s) => s.street_id === street.id);
      if (!found) continue;
      note = found.note;
      reversed = found.reversed;
      done = found.done;
      geometry = found.geometry;
    }
    return baseStages.map((stage) => {
      const streets = stage.streets.filter((s) => s.street_id !== street.id);
      if (stage.stage_no !== stageNo) return { ...stage, streets };
      return {
        ...stage,
        streets: [
          ...streets,
          {
            street_id: street.id,
            name_he: street.name_he,
            note,
            from_ratio: street.from_ratio ?? 0,
            to_ratio: street.to_ratio ?? 1,
            reversed: street.reversed ?? reversed,
            done,
            geometry,
          },
        ],
      };
    });
  }

  bindRef.current = {
    addStreet(street) {
      const { stages: base, stageNo } = withStage(activeRef.current);
      activeRef.current = stageNo;
      setActive(stageNo);
      const next = base.map((stage) => {
        if (stage.stage_no !== stageNo) return stage;
        if (stage.streets.some((s) => s.street_id === street.id)) return stage;
        return {
          ...stage,
          streets: [
            ...stage.streets,
            {
              street_id: street.id,
              name_he: street.name_he,
              note: "",
              from_ratio: street.from_ratio ?? 0,
              to_ratio: street.to_ratio ?? 1,
              reversed: Boolean(street.reversed),
              done: false,
              geometry: null,
            },
          ],
        };
      });
      if (next.every((stage, i) => stage === base[i])) return;
      void persist(next);
    },
    addStreetToStage(street, stageNo) {
      const prev = stagesRef.current;
      if (!prev.some((stage) => stage.stage_no === stageNo)) return;
      activeRef.current = stageNo;
      setActive(stageNo);
      void persist(placeStreet(street, stageNo, prev));
    },
    addStreetToNewStage(street) {
      const stripped = stagesRef.current.map((stage) => ({
        ...stage,
        streets: stage.streets.filter((s) => s.street_id !== street.id),
      }));
      const stageNo = (stripped.at(-1)?.stage_no ?? 0) + 1;
      activeRef.current = stageNo;
      setActive(stageNo);
      void persist([
        ...stripped,
        {
          stage_no: stageNo,
          streets: [{
            street_id: street.id,
            name_he: street.name_he,
            note: "",
            from_ratio: street.from_ratio ?? 0,
            to_ratio: street.to_ratio ?? 1,
            reversed: Boolean(street.reversed),
            done: false,
            geometry: null,
          }],
          point: null,
        },
      ]);
    },
    addPoint(lat, lng) {
      const { stages: base, stageNo } = withStage(activeRef.current);
      activeRef.current = stageNo;
      setActive(stageNo);
      const next = base.map((stage) =>
        stage.stage_no === stageNo
          ? {
              ...stage,
              point: { lat, lng, note: stage.point?.note ?? "" },
            }
          : stage,
      );
      onMode("off");
      void persist(next);
    },
    addStartPoint(lat, lng) {
      const prev = stagesRef.current;
      const base =
        prev.length === 0 ? [{ stage_no: 1, streets: [], point: null }] : prev;
      activeRef.current = 1;
      setActive(1);
      const next = base.map((stage) =>
        stage.stage_no === 1
          ? { ...stage, point: { lat, lng, note: stage.point?.note ?? "" } }
          : stage,
      );
      onMode("off");
      void persist(next);
    },
    setStagePoint(stageNo, lat, lng) {
      const prev = stagesRef.current;
      if (!prev.some((stage) => stage.stage_no === stageNo)) return;
      const next = prev.map((stage) =>
        stage.stage_no === stageNo
          ? { ...stage, point: { lat, lng, note: stage.point?.note ?? "" } }
          : stage,
      );
      onMode("off");
      void persist(next);
    },
    addCollectionPoint(lat, lng) {
      const prev = stagesRef.current;
      const open = prev.find((stage) => stage.stage_no > 1 && !stage.point);
      if (open) {
        const next = prev.map((stage) =>
          stage.stage_no === open.stage_no
            ? { ...stage, point: { lat, lng, note: stage.point?.note ?? "" } }
            : stage,
        );
        onMode("off");
        void persist(next);
        return;
      }
      const base = prev.length === 0 ? [{ stage_no: 1, streets: [], point: null }] : prev;
      const nextNo = (base.at(-1)?.stage_no ?? 1) + 1;
      const stageNo = nextNo < 2 ? 2 : nextNo;
      const withFirst =
        base.some((stage) => stage.stage_no === 1)
          ? base
          : [{ stage_no: 1, streets: [], point: null }, ...base];
      void persist([
        ...withFirst,
        { stage_no: stageNo, streets: [], point: { lat, lng, note: "" } },
      ]);
    },
  };

  function addStage() {
    const nextNo = (stagesRef.current.at(-1)?.stage_no ?? 0) + 1;
    const next = [
      ...stagesRef.current,
      { stage_no: nextNo, streets: [], point: null },
    ];
    setActive(nextNo);
    onMode("off");
    void persist(next);
  }

  function removeStage(stageNo: number) {
    const next = stagesRef.current
      .filter((s) => s.stage_no !== stageNo)
      .map((s, i) => ({ ...s, stage_no: i + 1 }));
    if (activeRef.current === stageNo) {
      setActive(next[0]?.stage_no ?? null);
      onMode("off");
    }
    void persist(next);
  }

  function removeStreet(stageNo: number, streetId: string) {
    const next = stagesRef.current.map((stage) =>
      stage.stage_no === stageNo
        ? { ...stage, streets: stage.streets.filter((s) => s.street_id !== streetId) }
        : stage,
    );
    void persist(next);
  }

  function updateStreetNote(stageNo: number, streetId: string, note: string) {
    const next = stagesRef.current.map((stage) =>
      stage.stage_no === stageNo
        ? {
            ...stage,
            streets: stage.streets.map((s) =>
              s.street_id === streetId ? { ...s, note } : s,
            ),
          }
        : stage,
    );
    stagesRef.current = next;
    setStages(next);
  }

  function updatePointNote(stageNo: number, note: string) {
    const next = stagesRef.current.map((stage) =>
      stage.stage_no === stageNo && stage.point
        ? { ...stage, point: { ...stage.point, note } }
        : stage,
    );
    stagesRef.current = next;
    setStages(next);
  }

  function noteValue(
    edit: NonNullable<typeof noteEdit>,
  ) {
    const stage = stagesRef.current.find((item) => item.stage_no === edit.stageNo);
    if (!stage) return "";
    if (edit.kind === "point") return stage.point?.note ?? "";
    return stage.streets.find((street) => street.street_id === edit.streetId)?.note ?? "";
  }

  function closeNote() {
    void persist(stagesRef.current);
    setNoteEdit(null);
  }

  function toggleStreetDone(stageNo: number, streetId: string) {
    const next = stagesRef.current.map((stage) =>
      stage.stage_no === stageNo
        ? {
            ...stage,
            streets: stage.streets.map((street) =>
              street.street_id === streetId ? { ...street, done: !street.done } : street,
            ),
          }
        : stage,
    );
    void persist(next);
  }

  function setReversed(stageNo: number, streetId: string, reversed: boolean) {
    const next = stagesRef.current.map((stage) =>
      stage.stage_no === stageNo
        ? {
            ...stage,
            streets: stage.streets.map((street) =>
              street.street_id === streetId ? { ...street, reversed } : street,
            ),
          }
        : stage,
    );
    void persist(next);
  }

  function clearPoint(stageNo: number) {
    const next = stagesRef.current.map((stage) =>
      stage.stage_no === stageNo ? { ...stage, point: null } : stage,
    );
    void persist(next);
  }

  const shownStages =
    stageFilter === "all" ? stages : stages.filter((stage) => stage.stage_no === stageFilter);

  return (
    <section className="route-panel">
      <div className="route-stage-head">
        <h3>מסלול</h3>
        <span className="route-row-actions">
          <button
            type="button"
            className="route-icon-btn"
            aria-label={stageFilter === "all" ? "סינון שלבים: הכל" : `סינון שלבים: שלב ${stageFilter}`}
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
          >
            <FilterMark />
          </button>
          <button type="button" className="route-icon-btn" aria-label="שלב חדש" onClick={addStage}>
            +
          </button>
        </span>
      </div>
      {filterOpen ? (
        <div className="route-filter-menu" role="menu">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={stageFilter === "all"}
            onClick={() => {
              setStageFilter("all");
              setFilterOpen(false);
            }}
          >
            הכל
          </button>
          {stages.map((stage) => (
            <button
              key={stage.stage_no}
              type="button"
              role="menuitemradio"
              aria-checked={stageFilter === stage.stage_no}
              onClick={() => {
                setStageFilter(stage.stage_no);
                setFilterOpen(false);
              }}
            >
              שלב {stage.stage_no}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p className="form-msg form-msg-err" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="assign-empty">טוען מסלול…</p> : null}
      {!loading && stages.length === 0 ? (
        <p className="assign-empty">
          לחיצה ארוכה על רחוב פותחת בחירת שלב. לחיצה כפולה מחוץ לרחוב פותחת נקודת התחלה או איסוף.
        </p>
      ) : null}
      {shownStages.map((stage) => {
        const expanded = openStage === stage.stage_no;
        return (
          <article className="route-stage" key={stage.stage_no}>
            <div className="route-stage-summary">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpenStage(expanded ? null : stage.stage_no)}
              >
                <strong style={{ color: stageColor(stage.stage_no) }}>שלב {stage.stage_no}</strong>
              </button>
              <span className="route-stage-names">
                {stage.streets.map((street) => (
                  <button
                    key={street.street_id}
                    type="button"
                    className={street.done ? "route-name-done" : undefined}
                    onClick={() => toggleStreetDone(stage.stage_no, street.street_id)}
                  >
                    {street.name_he}
                    {street.done ? " · בוצע" : ""}
                  </button>
                ))}
              </span>
            </div>
            {expanded ? (
              <div className="route-stage-more">
                {stage.streets.map((street) => (
                  <div className="route-inline" key={street.street_id}>
                    <span className="route-more-name">{street.name_he}</span>
                    <button
                      type="button"
                      className="route-icon-btn"
                      aria-pressed={!street.reversed}
                      aria-label="כיוון הרחוב"
                      onClick={() => setReversed(stage.stage_no, street.street_id, false)}
                    >
                      <DirMark />
                    </button>
                    <button
                      type="button"
                      className="route-icon-btn"
                      aria-pressed={street.reversed}
                      aria-label="כיוון הפוך"
                      onClick={() => setReversed(stage.stage_no, street.street_id, true)}
                    >
                      <DirMark flip />
                    </button>
                    <button
                      type="button"
                      className="route-btn"
                      onClick={() =>
                        setNoteEdit({
                          kind: "street",
                          stageNo: stage.stage_no,
                          streetId: street.street_id,
                          title: street.name_he,
                        })
                      }
                    >
                      הערות
                    </button>
                    <button
                      type="button"
                      className="route-btn"
                      onClick={() => removeStreet(stage.stage_no, street.street_id)}
                    >
                      הסר
                    </button>
                  </div>
                ))}
                <div className="route-inline">
                  <span>{stage.point ? pointName(stage.stage_no) : `אין ${pointName(stage.stage_no)}`}</span>
                  {stage.point ? (
                    <button type="button" className="route-btn" onClick={() => clearPoint(stage.stage_no)}>
                      הסר נקודה
                    </button>
                  ) : null}
                  <button type="button" className="route-btn" onClick={() => removeStage(stage.stage_no)}>
                    מחק שלב
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
      {noteEdit ? (
        <div className="note-float-back" onClick={closeNote}>
          <div
            className="note-float"
            role="dialog"
            aria-label={noteEdit.title}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="route-stage-head">
              <strong>הערות · {noteEdit.title}</strong>
              <button type="button" className="route-btn" onClick={closeNote}>
                סגור
              </button>
            </div>
            <textarea
              autoFocus
              maxLength={500}
              placeholder="כתבו הערה"
              value={noteValue(noteEdit)}
              onChange={(event) => {
                if (noteEdit.kind === "street") {
                  updateStreetNote(noteEdit.stageNo, noteEdit.streetId, event.target.value);
                } else {
                  updatePointNote(noteEdit.stageNo, event.target.value);
                }
              }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
