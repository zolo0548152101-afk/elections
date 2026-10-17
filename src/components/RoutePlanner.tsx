"use client";

import { MAP_COLOR, routeStageColor } from "@/lib/map-colors";
import { tourBridge } from "@/lib/tour-bridge";
import { useEffect, useRef, useState } from "react";
import type { Feature, LineString } from "geojson";
import type { RouteDraw, RouteStage } from "@/lib/cluster-route-types";
import { arrowMarksEvery, formatLengthPill, formatMeters, lineLengthMeters } from "@/lib/street-span";


/** How many route changes "ביטול פעולה אחרונה" can take back. */
const UNDO_MAX = 30;

/** Curved arrow back (undo). */
function UndoMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M9 7 4 12l5 5M4.5 12H14a5.5 5.5 0 0 1 0 11h-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(1 -3)"
      />
    </svg>
  );
}

function pointName(stageNo: number) {
  return stageNo === 1 ? "נקודת התחלה" : "נקודת קיבוץ";
}

export function stageColor(stageNo: number) {
  return routeStageColor(stageNo);
}

function RouteMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M5 17 C9 17 9 7 13 7 C17 7 17 14 19 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="5" cy="17" r="2" fill="currentColor" />
      <circle cx="19" cy="14" r="2" fill="currentColor" />
    </svg>
  );
}

function PointMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M12 3 C8 3 5.5 6 5.5 9.5 C5.5 14 12 21 12 21 C12 21 18.5 14 18.5 9.5 C18.5 6 16 3 12 3 Z" fill="currentColor" />
      <circle cx="12" cy="9.5" r="2" fill="#fff" />
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

export type RouteMode = "off" | "street" | "point" | "stretch";

const VERTEX_MAX = 60;
const DRAW_MAX = 30;

function blankStage(stageNo: number, point: RouteStage["point"] = null): RouteStage {
  return { stage_no: stageNo, streets: [], draws: [], point };
}

function asDraws(draws: RouteDraw[] | undefined) {
  return Array.isArray(draws) ? draws : [];
}

function validPoint(lng: number, lat: number) {
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
}

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
  stretchPoint: (lng: number, lat: number) => void;
  moveStretchVertex: (stageNo: number, drawIndex: number, vertex: number, lng: number, lat: number, save: boolean) => void;
  insertStretchVertex: (stageNo: number, drawIndex: number, after: number, lng: number, lat: number) => number;
  commitStretch: () => void;
  newStretchSegment: () => void;
  finishStretch: () => boolean;
  selectStretch: (stageNo: number, index: number) => void;
  editStretch: (stageNo: number, index: number, frame?: boolean) => void;
  placeRoutePoint: (lat: number, lng: number) => void;
  splitStretch: (stageNo: number, drawIndex: number, vertex: number) => void;
  flipStageStretches: (stageNo: number) => void;
  setStretchDone: (stageNo: number, drawIndex: number, done: boolean) => void;
  removeStretch: (stageNo: number, drawIndex: number) => void;
};

function toFeatures(
  stages: RouteStage[],
  picked: { stage: number; index: number } | null,
): Feature[] {
  const features: Feature[] = [];
  for (const stage of stages) {
    const color = stageColor(stage.stage_no);
    for (const [index, draw] of asDraws(stage.draws).entries()) {
      const coordinates = draw.coordinates ?? [];
      const color = draw.done ? MAP_COLOR.streetDone : stageColor(stage.stage_no);
      if (coordinates.length >= 2) {
        features.push({
          type: "Feature",
          properties: {
            color,
            stage: stage.stage_no,
            kind: "draw",
            draw: index,
            done: draw.done ? 1 : 0,
            id: "",
            name_he: "",
          },
          geometry: { type: "LineString", coordinates },
        });
        for (const mark of arrowMarksEvery(coordinates, 40)) {
          features.push({
            type: "Feature",
            properties: { kind: "arrow", bearing: mark.bearing },
            geometry: { type: "Point", coordinates: [mark.lng, mark.lat] },
          });
        }
        const last = coordinates[coordinates.length - 1]!;
        const mid = coordinates[Math.floor((coordinates.length - 1) / 2)]!;
        const selected = picked?.stage === stage.stage_no && picked.index === index;
        features.push({
          type: "Feature",
          properties: {
            kind: "meter",
            label: `${index + 1} · ${formatLengthPill(lineLengthMeters(coordinates))}`,
            stage: stage.stage_no,
            draw: index,
          },
          geometry: { type: "Point", coordinates: last },
        });
        features.push({
          type: "Feature",
          properties: {
            kind: "stretch-no",
            label: String(index + 1),
            stage: stage.stage_no,
            draw: index,
            selected: selected ? 1 : 0,
          },
          geometry: { type: "Point", coordinates: mid },
        });
      }
      coordinates.forEach((coord, vertex) => {
        const label =
          vertex === 0 ? "A" : draw.finished && vertex === coordinates.length - 1 ? "B" : "";
        features.push({
          type: "Feature",
          properties: {
            kind: "handle",
            color,
            stage: stage.stage_no,
            draw: index,
            vertex,
            count: coordinates.length,
            label,
          },
          geometry: { type: "Point", coordinates: coord },
        });
      });
    }
    if (stage.point) {
      const collectNo = stages.filter((item) => item.stage_no > 1 && item.stage_no <= stage.stage_no && item.point).length;
      features.push({
        type: "Feature",
        properties: {
          color,
          stage: stage.stage_no,
          kind: "point",
          label: stage.stage_no === 1 ? "התחלה" : `נקודת קיבוץ ${collectNo}`,
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
      stage_no: stage.stage_no,
      streets: stage.streets.map((s) => ({
        street_id: s.street_id,
        note: s.note,
        from_ratio: s.from_ratio ?? 0,
        to_ratio: s.to_ratio ?? 1,
        reversed: Boolean(s.reversed),
        done: Boolean(s.done),
      })),
      draws: asDraws(stage.draws).map((draw) => ({
        coordinates: draw.coordinates,
        done: Boolean(draw.done),
        finished: Boolean(draw.finished),
      })),
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
  onActive,
  onDrawDone,
  onShowStage,
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
  onActive: (stageNo: number | null) => void;
  onDrawDone?: (draw: { stageNo: number; index: number; coordinates: number[][]; done: boolean }) => void;
  onShowStage?: (points: [number, number][]) => void;
  bindRef: React.MutableRefObject<RouteApi | null>;
}) {
  const [stages, setStages] = useState<RouteStage[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<number | "all">("all");
  const [openStage, setOpenStage] = useState<number | null>(null);
  const [pickedDraw, setPickedDraw] = useState<{ stage: number; index: number } | null>(null);
  const [noteEdit, setNoteEdit] = useState<
    | { kind: "street"; stageNo: number; streetId: string; title: string }
    | { kind: "point"; stageNo: number; title: string }
    | null
  >(null);
  const [removeAsk, setRemoveAsk] = useState<
    | { kind: "stage"; stageNo: number; label: string }
    | { kind: "draw"; stageNo: number; index: number; label: string }
    | { kind: "point"; stageNo: number; label: string }
    | { kind: "street"; stageNo: number; streetId: string; label: string }
    | null
  >(null);
  const holdRef = useRef<{ timer: number | null; fired: boolean; x: number; y: number }>({
    timer: null,
    fired: false,
    x: 0,
    y: 0,
  });
  const stagesRef = useRef(stages);
  const activeRef = useRef(active);
  const chainRef = useRef<{ stageNo: number; index: number } | null>(null);
  const saveTail = useRef<Promise<void>>(Promise.resolve());
  /** Undo: the route as last saved, and the saved states before it (newest last). */
  const committedRef = useRef<RouteStage[]>([]);
  const historyRef = useRef<RouteStage[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const onDrawDoneRef = useRef(onDrawDone);
  onDrawDoneRef.current = onDrawDone;
  const onShowRef = useRef(onShowStage);
  onShowRef.current = onShowStage;
  const ashkolRef = useRef(ashkol);
  const ticket = useRef(0);
  const onFeaturesRef = useRef(onFeatures);
  const onStagesRef = useRef(onStages);
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
  stagesRef.current = stages;
  activeRef.current = active;
  ashkolRef.current = ashkol;
  onFeaturesRef.current = onFeatures;
  onStagesRef.current = onStages;

  useEffect(() => {
    const shown =
      stageFilter === "all" ? stages : stages.filter((stage) => stage.stage_no === stageFilter);
    onFeaturesRef.current(toFeatures(shown, pickedDraw));
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
  }, [stages, stageFilter, pickedDraw]);

  useEffect(() => {
    onActiveRef.current(active);
  }, [active]);

  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    tourBridge.getStages = () => stagesRef.current;
    tourBridge.reloadRoute = () => setReloadTick((n) => n + 1);
    return () => {
      tourBridge.getStages = undefined;
      tourBridge.reloadRoute = undefined;
    };
  }, []);

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
        const normalized = next.map((stage) => ({ ...stage, draws: asDraws(stage.draws) }));
        chainRef.current = null;
        stagesRef.current = normalized;
        committedRef.current = normalized;
        historyRef.current = [];
        setCanUndo(false);
        setStages(normalized);
        setActive(normalized[0]?.stage_no ?? null);
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
  }, [ashkol, reloadTick]);

  function preview(next: RouteStage[]) {
    ticket.current += 1;
    stagesRef.current = next;
    setStages(next);
  }

  function persist(next: RouteStage[], opts: { undo?: boolean } = {}) {
    // Remember the state before this change, so "ביטול פעולה אחרונה" can bring it back.
    if (!opts.undo && JSON.stringify(payload(committedRef.current)) !== JSON.stringify(payload(next))) {
      historyRef.current = [...historyRef.current, committedRef.current].slice(-UNDO_MAX);
      setCanUndo(true);
    }
    committedRef.current = next;
    const savedFor = ashkol;
    const my = ++ticket.current;
    stagesRef.current = next;
    setStages(next);
    const job = saveTail.current.then(async () => {
      if (my !== ticket.current || savedFor !== ashkolRef.current) return;
      const res = await fetch(`/api/clusters/${encodeURIComponent(savedFor)}/route`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(stagesRef.current)),
      });
      const data = await res.json().catch(() => ({}));
      if (my !== ticket.current || savedFor !== ashkolRef.current) return;
      if (!res.ok) {
        setError(data.error || "שגיאה בשמירת המסלול");
        return;
      }
      setError(null);
      const saved = ((data.stages ?? []) as RouteStage[]).map((stage) => ({
        ...stage,
        draws: asDraws(stage.draws),
      }));
      stagesRef.current = saved;
      committedRef.current = saved;
      setStages(saved);
    });
    saveTail.current = job.then(
      () => undefined,
      () => undefined,
    );
  }

  /** Bring back the route as it was before the last change, and save it. */
  function undoLast() {
    const prev = historyRef.current[historyRef.current.length - 1];
    if (!prev) return;
    historyRef.current = historyRef.current.slice(0, -1);
    setCanUndo(historyRef.current.length > 0);
    chainRef.current = null;
    setPickedDraw(null);
    if (activeRef.current != null && !prev.some((stage) => stage.stage_no === activeRef.current)) {
      setActive(prev[prev.length - 1]?.stage_no ?? null);
    }
    persist(prev, { undo: true });
  }

  function withStage(stageNo: number | null) {
    const prev = stagesRef.current;
    if (prev.length === 0) {
      return { stages: [blankStage(1)], stageNo: 1 };
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
      if (Number(stage.stage_no) !== Number(stageNo)) return { ...stage, streets };
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

  function showPoint(stageNo: number) {
    const stage = stagesRef.current.find((item) => Number(item.stage_no) === Number(stageNo));
    if (!stage?.point || !onShowRef.current) return;
    setActive(stage.stage_no);
    activeRef.current = stage.stage_no;
    onShowRef.current([[stage.point.lng, stage.point.lat]]);
  }

  function pressRemove(event: React.PointerEvent, open: () => void) {
    const hold = holdRef.current;
    hold.fired = false;
    hold.x = event.clientX;
    hold.y = event.clientY;
    if (hold.timer != null) window.clearTimeout(hold.timer);
    hold.timer = window.setTimeout(() => {
      hold.fired = true;
      hold.timer = null;
      open();
      const swallow = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        hold.fired = false;
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
    }, 550);
  }

  function moveRemove(event: React.PointerEvent) {
    const hold = holdRef.current;
    if (hold.timer == null) return;
    if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 8) {
      window.clearTimeout(hold.timer);
      hold.timer = null;
    }
  }

  function endRemove() {
    const hold = holdRef.current;
    if (hold.timer != null) window.clearTimeout(hold.timer);
    hold.timer = null;
  }

  function ateHoldClick() {
    if (!holdRef.current.fired) return false;
    holdRef.current.fired = false;
    return true;
  }

  function removeStage(stageNo: number) {
    const target = Number(stageNo);
    const next = stagesRef.current.filter((stage) => Number(stage.stage_no) !== target);
    if (Number(activeRef.current) === target) {
      const fallback = next[0]?.stage_no ?? null;
      activeRef.current = fallback;
      setActive(fallback);
    }
    if (openStage === target) setOpenStage(null);
    if (stageFilter === target) setStageFilter("all");
    onMode("off");
    void persist(next);
  }

  function confirmRemove() {
    const ask = removeAsk;
    setRemoveAsk(null);
    if (!ask) return;
    if (ask.kind === "stage") removeStage(ask.stageNo);
    else if (ask.kind === "draw") bindRef.current?.removeStretch(ask.stageNo, ask.index);
    else if (ask.kind === "point") clearPoint(ask.stageNo);
    else removeStreet(ask.stageNo, ask.streetId);
  }

  function revealStage(stageNo: number) {
    const stage = stagesRef.current.find((item) => Number(item.stage_no) === Number(stageNo));
    if (!stage || !onShowRef.current) return;
    const points: [number, number][] = [];
    for (const draw of asDraws(stage.draws)) {
      for (const coord of draw.coordinates ?? []) {
        if (coord.length >= 2) points.push([coord[0]!, coord[1]!]);
      }
    }
    if (stage.point) points.push([stage.point.lng, stage.point.lat]);
    onShowRef.current(points);
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
      const target = Number(stageNo);
      if (!prev.some((stage) => Number(stage.stage_no) === target)) return;
      activeRef.current = target;
      setActive(target);
      void persist(placeStreet(street, target, prev));
    },
    addStreetToNewStage(street) {
      const stripped = stagesRef.current.map((stage) => ({
        ...stage,
        streets: stage.streets.filter((s) => s.street_id !== street.id),
      }));
      const stageNo = stripped.reduce((max, stage) => Math.max(max, Number(stage.stage_no) || 0), 0) + 1;
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
          draws: [],
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
        prev.length === 0 ? [blankStage(1)] : prev;
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
    placeRoutePoint(lat, lng) {
      const prev = stagesRef.current;
      const wanted = activeRef.current ?? prev[0]?.stage_no ?? 1;
      const base = prev.length === 0 ? [blankStage(1)] : prev;
      const target = base.some((stage) => Number(stage.stage_no) === Number(wanted))
        ? wanted
        : base[0]!.stage_no;
      activeRef.current = target;
      setActive(target);
      void persist(
        base.map((stage) =>
          Number(stage.stage_no) === Number(target)
            ? { ...stage, point: { lat, lng, note: stage.point?.note ?? "" } }
            : stage,
        ),
      );
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
      const base = prev.length === 0 ? [blankStage(1)] : prev;
      const nextNo = base.reduce((max, stage) => Math.max(max, Number(stage.stage_no) || 0), 0) + 1;
      const stageNo = nextNo < 2 ? 2 : nextNo;
      const withFirst =
        base.some((stage) => stage.stage_no === 1)
          ? base
          : [blankStage(1), ...base];
      void persist([
        ...withFirst,
        { ...blankStage(stageNo), point: { lat, lng, note: "" } },
      ]);
    },
    stretchPoint(lng, lat) {
      if (!validPoint(lng, lat)) return;
      const { stages: base, stageNo } = withStage(activeRef.current);
      activeRef.current = stageNo;
      setActive(stageNo);
      const chain = chainRef.current;
      const next = base.map((stage) => {
        if (Number(stage.stage_no) !== Number(stageNo)) return stage;
        const draws = asDraws(stage.draws);
        if (chain && chain.stageNo === stageNo && draws[chain.index]) {
          const coordinates = [...draws[chain.index]!.coordinates, [lng, lat]].slice(0, VERTEX_MAX);
          return {
            ...stage,
            draws: draws.map((draw, index) => (index === chain.index ? { ...draw, coordinates } : draw)),
          };
        }
        if (draws.length >= DRAW_MAX) return stage;
        const added = [...draws, { coordinates: [[lng, lat]], done: false, finished: false }];
        chainRef.current = { stageNo, index: added.length - 1 };
        return { ...stage, draws: added };
      });
      void persist(next);
    },
    moveStretchVertex(stageNo, drawIndex, vertex, lng, lat, save) {
      if (!validPoint(lng, lat)) return;
      const next = stagesRef.current.map((stage) => {
        if (Number(stage.stage_no) !== Number(stageNo)) return stage;
        return {
          ...stage,
          draws: asDraws(stage.draws).map((draw, index) => {
            if (index !== drawIndex) return draw;
            if (vertex < 0 || vertex >= draw.coordinates.length) return draw;
            const coordinates = draw.coordinates.map((point, pointIndex) =>
              pointIndex === vertex ? [lng, lat] : point,
            );
            return { ...draw, coordinates };
          }),
        };
      });
      if (save) void persist(next);
      else preview(next);
    },
    insertStretchVertex(stageNo, drawIndex, after, lng, lat) {
      if (!validPoint(lng, lat)) return after;
      let inserted = after;
      const next = stagesRef.current.map((stage) => {
        if (Number(stage.stage_no) !== Number(stageNo)) return stage;
        return {
          ...stage,
          draws: asDraws(stage.draws).map((draw, index) => {
            if (index !== drawIndex) return draw;
            if (draw.coordinates.length >= VERTEX_MAX) return draw;
            const coordinates = draw.coordinates.slice();
            inserted = Math.min(coordinates.length, Math.max(0, after + 1));
            coordinates.splice(inserted, 0, [lng, lat]);
            return { ...draw, coordinates };
          }),
        };
      });
      preview(next);
      return inserted;
    },
    commitStretch() {
      void persist(stagesRef.current);
    },
    finishStretch() {
      const chain = chainRef.current;
      chainRef.current = null;
      const stageNo = chain?.stageNo ?? activeRef.current;
      if (stageNo == null) return false;
      let closed = false;
      const next = stagesRef.current.map((stage) => {
        if (Number(stage.stage_no) !== Number(stageNo)) return stage;
        const draws = asDraws(stage.draws);
        const index = chain && chain.stageNo === stageNo ? chain.index : draws.length - 1;
        return {
          ...stage,
          draws: draws.map((draw, drawIndex) => {
            if (drawIndex !== index || draw.finished || draw.coordinates.length < 2) return draw;
            closed = true;
            return { ...draw, finished: true };
          }),
        };
      });
      if (!closed) return false;
      onMode("off");
      void persist(next);
      return true;
    },
    newStretchSegment() {
      bindRef.current?.finishStretch();
      chainRef.current = null;
    },
    selectStretch(stageNo, index) {
      setPickedDraw({ stage: stageNo, index });
      activeRef.current = stageNo;
      setActive(stageNo);
      setOpenStage(stageNo);
      onMode("off");
      revealStage(stageNo);
    },
    editStretch(stageNo, index, frame = true) {
      const stageNumber = Number(stageNo);
      const drawIndex = Number(index);
      if (!Number.isFinite(stageNumber) || !Number.isFinite(drawIndex)) return;
      chainRef.current = { stageNo: stageNumber, index: drawIndex };
      activeRef.current = stageNumber;
      setActive(stageNumber);
      setOpenStage(stageNumber);
      setPickedDraw({ stage: stageNumber, index: drawIndex });
      onMode("stretch");
      const next = stagesRef.current.map((stage) => {
        if (Number(stage.stage_no) !== stageNumber) return stage;
        return {
          ...stage,
          draws: asDraws(stage.draws).map((draw, i) =>
            i === drawIndex ? { ...draw, finished: false } : draw,
          ),
        };
      });
      if (frame) persist(next);
      else preview(next);
      if (frame) revealStage(stageNumber);
    },
    splitStretch(stageNo, drawIndex, vertex) {
      const next = stagesRef.current.map((stage) => {
        if (Number(stage.stage_no) !== Number(stageNo)) return stage;
        const draws = asDraws(stage.draws);
        const draw = draws[drawIndex];
        if (!draw || vertex <= 0 || vertex >= draw.coordinates.length - 1) return stage;
        if (draws.length >= DRAW_MAX) return stage;
        const left = { ...draw, coordinates: draw.coordinates.slice(0, vertex + 1) };
        const right = { ...draw, coordinates: draw.coordinates.slice(vertex), done: false };
        const replaced = draws.slice();
        replaced.splice(drawIndex, 1, left, right);
        return { ...stage, draws: replaced };
      });
      chainRef.current = null;
      void persist(next);
    },
    flipStageStretches(stageNo) {
      const next = stagesRef.current.map((stage) => {
        if (Number(stage.stage_no) !== Number(stageNo)) return stage;
        return {
          ...stage,
          draws: asDraws(stage.draws).map((draw) => ({
            ...draw,
            coordinates: [...draw.coordinates].reverse(),
          })),
        };
      });
      chainRef.current = null;
      void persist(next);
    },
    setStretchDone(stageNo, drawIndex, done) {
      let changed: RouteDraw | null = null;
      const next = stagesRef.current.map((stage) => {
        if (Number(stage.stage_no) !== Number(stageNo)) return stage;
        return {
          ...stage,
          draws: asDraws(stage.draws).map((draw, index) => {
            if (index !== drawIndex) return draw;
            changed = { ...draw, done };
            return changed;
          }),
        };
      });
      void persist(next);
      if (changed) {
        onDrawDoneRef.current?.({
          stageNo,
          index: drawIndex,
          coordinates: (changed as RouteDraw).coordinates,
          done,
        });
      }
    },
    removeStretch(stageNo, drawIndex) {
      const next = stagesRef.current.map((stage) => {
        if (Number(stage.stage_no) !== Number(stageNo)) return stage;
        return { ...stage, draws: asDraws(stage.draws).filter((_, index) => index !== drawIndex) };
      });
      if (chainRef.current?.stageNo === stageNo) chainRef.current = null;
      void persist(next);
    },
  };
  tourBridge.routeApi = bindRef.current;

  function nextStageNo() {
    return stagesRef.current.reduce((max, stage) => Math.max(max, Number(stage.stage_no) || 0), 0) + 1;
  }

  function addStage(keepStretch = false) {
    bindRef.current?.finishStretch();
    chainRef.current = null;
    const nextNo = nextStageNo();
    const next = [...stagesRef.current, blankStage(nextNo)];
    activeRef.current = nextNo;
    setActive(nextNo);
    setPickedDraw(null);
    if (!keepStretch) onMode("off");
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
      <div className="route-icon-row" role="toolbar" aria-label="מסלול">
        <button
          type="button"
          className="route-icon-btn"
          aria-pressed={mode === "stretch"}
          aria-label="הוספת מסלול"
          data-tour="route-draw"
          data-tip="הוספת מסלול"
          onClick={() => onMode(mode === "stretch" ? "off" : "stretch")}
        >
          <RouteMark />
        </button>
        <button
          type="button"
          className="route-icon-btn"
          aria-pressed={mode === "point"}
          aria-label="סימון נקודת התחלה/קיבוץ"
          data-tour="route-point"
          data-tip="סימון נקודת התחלה/קיבוץ"
          onClick={() => onMode(mode === "point" ? "off" : "point")}
        >
          <PointMark />
        </button>
        <button
          type="button"
          className="route-icon-btn"
          aria-label="הוספת שלב"
          data-tour="route-stage"
          data-tip="הוספת שלב"
          onClick={() => addStage()}
        >
          +
        </button>
        <button
          type="button"
          className="route-icon-btn"
          aria-label="ביטול פעולה אחרונה"
          data-tour="route-undo"
          data-tip="ביטול פעולה אחרונה"
          disabled={!canUndo}
          onClick={() => undoLast()}
        >
          <UndoMark />
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
          לחצו על אייקון המסלול וסמנו על המפה. אייקון הנקודה מסמן התחלה או נקודת קיבוץ.
        </p>
      ) : null}
      {shownStages.map((stage) => {
        const expanded = openStage === stage.stage_no;
        return (
          <article
            className={`route-stage${active === stage.stage_no ? " is-current" : ""}`}
            key={stage.stage_no}
          >
            <div
              className="route-stage-summary"
              onClick={() => {
                if (active !== stage.stage_no) chainRef.current = null;
                setActive(stage.stage_no);
                activeRef.current = stage.stage_no;
                onMode("off");
                revealStage(stage.stage_no);
              }}
            >
              <button
                type="button"
                className="route-stage-x"
                aria-label={`מחק שלב ${stage.stage_no}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setRemoveAsk({
                    kind: "stage",
                    stageNo: stage.stage_no,
                    label: `שלב ${stage.stage_no}`,
                  });
                }}
              >
                ×
              </button>
              <button
                type="button"
                aria-expanded={expanded}
                aria-pressed={active === stage.stage_no}
                onClick={() => {
                  setActive(stage.stage_no);
                  activeRef.current = stage.stage_no;
                  setOpenStage(expanded ? null : stage.stage_no);
                  onMode("off");
                  revealStage(stage.stage_no);
                }}
              >
                <strong style={{ color: stageColor(stage.stage_no) }}>שלב {stage.stage_no}</strong>
              </button>
            </div>
            {expanded ? (
              <div className="route-stage-more">
                {stage.streets.map((street) => (
                  <div className="route-inline" key={street.street_id}>
                    <button
                      type="button"
                      className="route-more-name"
                      onPointerDown={(event) =>
                        pressRemove(event, () =>
                          setRemoveAsk({
                            kind: "street",
                            stageNo: stage.stage_no,
                            streetId: street.street_id,
                            label: street.name_he,
                          }),
                        )
                      }
                      onPointerMove={moveRemove}
                      onPointerUp={endRemove}
                      onPointerCancel={endRemove}
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      {street.name_he}
                    </button>
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
                  </div>
                ))}
                {asDraws(stage.draws).map((draw, index) => (
                  <div className="route-inline" key={`draw-row-${index}`}>
                    <button
                      type="button"
                      className="route-more-name route-resume"
                      aria-pressed={pickedDraw?.stage === stage.stage_no && pickedDraw.index === index}
                      onClick={() => {
                        if (ateHoldClick()) return;
                        bindRef.current?.editStretch(stage.stage_no, index);
                      }}
                      onPointerDown={(event) =>
                        pressRemove(event, () =>
                          setRemoveAsk({
                            kind: "draw",
                            stageNo: stage.stage_no,
                            index,
                            label: `מ.${index + 1}`,
                          }),
                        )
                      }
                      onPointerMove={moveRemove}
                      onPointerUp={endRemove}
                      onPointerCancel={endRemove}
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      מ.{index + 1} · {formatMeters(lineLengthMeters(draw.coordinates))}
                    </button>
                  </div>
                ))}
                <div className="route-inline">
                  {stage.point ? (
                    <button
                      type="button"
                      className="route-more-name"
                      onClick={() => {
                        if (ateHoldClick()) return;
                        showPoint(stage.stage_no);
                      }}
                      onPointerDown={(event) =>
                        pressRemove(event, () =>
                          setRemoveAsk({
                            kind: "point",
                            stageNo: stage.stage_no,
                            label: pointName(stage.stage_no),
                          }),
                        )
                      }
                      onPointerMove={moveRemove}
                      onPointerUp={endRemove}
                      onPointerCancel={endRemove}
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      {pointName(stage.stage_no)}
                    </button>
                  ) : (
                    <span>{`אין ${pointName(stage.stage_no)}`}</span>
                  )}
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
      {removeAsk ? (
        <div className="route-remove-pop" role="dialog" aria-label="הסרה">
          <p>
            {removeAsk.kind === "stage"
              ? `בטוח למחוק שלב ${removeAsk.stageNo}?`
              : `להסיר את ${removeAsk.label}?`}
          </p>
          <button type="button" className="route-btn" onClick={confirmRemove}>
            {removeAsk.kind === "stage" ? "מחק" : "הסר"}
          </button>
          <button type="button" className="route-btn" onClick={() => setRemoveAsk(null)}>
            ביטול
          </button>
        </div>
      ) : null}
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
