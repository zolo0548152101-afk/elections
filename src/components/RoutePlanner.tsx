"use client";

import { useEffect, useRef, useState } from "react";
import type { Feature, LineString } from "geojson";
import type { RouteStage } from "@/lib/cluster-route-types";

const STAGE_COLORS = ["#c45c26", "#2f6fed", "#0f766e", "#7c3aed", "#be123c", "#a16207"];

export function stageColor(stageNo: number) {
  return STAGE_COLORS[(Math.max(stageNo, 1) - 1) % STAGE_COLORS.length]!;
}

export type RouteMode = "off" | "street" | "point";

type StreetPick = { id: string; name_he: string };

export type RouteApi = {
  addStreet: (street: StreetPick) => void;
  addStreetToStage: (street: StreetPick, stageNo: number) => void;
  addStreetToNewStage: (street: StreetPick) => void;
  addPoint: (lat: number, lng: number) => void;
};

function toFeatures(stages: RouteStage[]): Feature[] {
  const features: Feature[] = [];
  for (const stage of stages) {
    const color = stageColor(stage.stage_no);
    for (const street of stage.streets) {
      if (!street.geometry) continue;
      const lines =
        street.geometry.type === "LineString"
          ? [street.geometry.coordinates]
          : street.geometry.coordinates;
      for (const coordinates of lines) {
        if (coordinates.length < 2) continue;
        const line: Feature<LineString> = {
          type: "Feature",
          properties: { color, stage: stage.stage_no, kind: "street" },
          geometry: { type: "LineString", coordinates },
        };
        features.push(line);
      }
    }
    if (stage.point) {
      features.push({
        type: "Feature",
        properties: { color, stage: stage.stage_no, kind: "point" },
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
      streets: stage.streets.map((s) => ({ street_id: s.street_id, note: s.note })),
      point: stage.point
        ? { lat: stage.point.lat, lng: stage.point.lng, note: stage.point.note }
        : null,
    })),
  };
}

export function RoutePlanner({
  ashkol,
  mode,
  onMode,
  onFeatures,
  onStages,
  bindRef,
}: {
  ashkol: string;
  mode: RouteMode;
  onMode: (mode: RouteMode) => void;
  onFeatures: (features: Feature[]) => void;
  onStages: (stages: { stage_no: number }[]) => void;
  bindRef: React.MutableRefObject<RouteApi | null>;
}) {
  const [stages, setStages] = useState<RouteStage[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
    onFeaturesRef.current(toFeatures(stages));
    onStagesRef.current(stages.map((stage) => ({ stage_no: stage.stage_no })));
  }, [stages]);

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
    let geometry: RouteStage["streets"][number]["geometry"] = null;
    for (const stage of baseStages) {
      const found = stage.streets.find((s) => s.street_id === street.id);
      if (!found) continue;
      note = found.note;
      geometry = found.geometry;
    }
    return baseStages.map((stage) => {
      const streets = stage.streets.filter((s) => s.street_id !== street.id);
      if (stage.stage_no !== stageNo) return { ...stage, streets };
      return {
        ...stage,
        streets: [
          ...streets,
          { street_id: street.id, name_he: street.name_he, note, geometry },
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
      if (prev.some((stage) => stage.stage_no === stageNo && stage.streets.some((s) => s.street_id === street.id))) {
        return;
      }
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
          streets: [{ street_id: street.id, name_he: street.name_he, note: "", geometry: null }],
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

  function clearPoint(stageNo: number) {
    const next = stagesRef.current.map((stage) =>
      stage.stage_no === stageNo ? { ...stage, point: null } : stage,
    );
    void persist(next);
  }

  return (
    <section className="route-panel">
      <div className="route-stage-head">
        <h3>מסלול</h3>
        <button type="button" className="route-btn" onClick={addStage}>
          שלב חדש
        </button>
      </div>
      {error ? (
        <p className="form-msg form-msg-err" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="assign-empty">טוען מסלול…</p> : null}
      {!loading && stages.length === 0 ? (
        <p className="assign-empty">
          לחיצה ארוכה על רחוב פותחת בחירת שלב. נצבעים רק הרחובות ששויכו לשלב.
        </p>
      ) : (
        <p className="assign-empty">
          לחיצה ארוכה על רחוב כדי לשייך אותו לשלב. כל שלב בצבע משלו.
        </p>
      )}
      {stages.map((stage) => {
        const pickingStreet = mode === "street" && active === stage.stage_no;
        const pickingPoint = mode === "point" && active === stage.stage_no;
        return (
          <article className="route-stage" key={stage.stage_no}>
            <div className="route-stage-head">
              <strong style={{ color: stageColor(stage.stage_no) }}>
                שלב {stage.stage_no}
              </strong>
              <button
                type="button"
                className="route-btn"
                onClick={() => removeStage(stage.stage_no)}
              >
                מחק שלב
              </button>
            </div>
            <div className="route-actions">
              <button
                type="button"
                className="route-btn"
                aria-pressed={pickingStreet}
                onClick={() => {
                  if (pickingStreet) onMode("off");
                  else {
                    setActive(stage.stage_no);
                    activeRef.current = stage.stage_no;
                    onMode("street");
                  }
                }}
              >
                {pickingStreet ? "מסיים בחירת רחוב" : "הוסף רחוב"}
              </button>
              <button
                type="button"
                className="route-btn"
                aria-pressed={pickingPoint}
                onClick={() => {
                  if (pickingPoint) onMode("off");
                  else {
                    setActive(stage.stage_no);
                    activeRef.current = stage.stage_no;
                    onMode("point");
                  }
                }}
              >
                {pickingPoint ? "מסיים נקודת איסוף" : "נקודת איסוף"}
              </button>
            </div>
            {stage.streets.length === 0 ? (
              <p className="assign-empty">אין רחובות בשלב זה.</p>
            ) : (
              stage.streets.map((street) => (
                <div className="route-street" key={street.street_id}>
                  <div className="route-stage-head">
                    <span>{street.name_he}</span>
                    <button
                      type="button"
                      className="route-btn"
                      onClick={() => removeStreet(stage.stage_no, street.street_id)}
                    >
                      הסר
                    </button>
                  </div>
                  <textarea
                    value={street.note}
                    maxLength={500}
                    placeholder="מלל על הרחוב"
                    onChange={(e) =>
                      updateStreetNote(stage.stage_no, street.street_id, e.target.value)
                    }
                    onBlur={() => void persist(stagesRef.current)}
                  />
                </div>
              ))
            )}
            {stage.point ? (
              <div className="route-street">
                <div className="route-stage-head">
                  <span>נקודת איסוף</span>
                  <button
                    type="button"
                    className="route-btn"
                    onClick={() => clearPoint(stage.stage_no)}
                  >
                    הסר
                  </button>
                </div>
                <textarea
                  value={stage.point.note}
                  maxLength={500}
                  placeholder="מלל על נקודת האיסוף"
                  onChange={(e) => updatePointNote(stage.stage_no, e.target.value)}
                  onBlur={() => void persist(stagesRef.current)}
                />
              </div>
            ) : (
              <p className="assign-empty">אין נקודת איסוף בשלב זה.</p>
            )}
          </article>
        );
      })}
    </section>
  );
}
