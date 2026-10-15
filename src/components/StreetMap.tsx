"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Turbopack rewrites the library chunk, so the relative worker URL 404s.
setWorkerUrl("/maplibre-gl-worker.mjs");
import type { ClusterView } from "./ClusterTable";
import { ShowMore } from "@/components/ShowMore";
import { useCloseOnOutsideClick, useMapFocus } from "./street-map/useMapFocus";
import type { Feature, Geometry } from "geojson";
import { matchesSearch } from "@/lib/text-search";
import { arrowMarksEvery, closestInsert, directedGeometry, spanOf } from "@/lib/street-span";
import type { RouteGeometry } from "@/lib/cluster-route-types";
import { RoutePlanner, stageColor, type RouteMode, type RouteApi } from "@/components/RoutePlanner";
import { eshkolColorMap } from "@/lib/eshkol-house-colors";
import { CLUSTER_STAGE_LABEL, clusterStage } from "@/lib/cluster-stage";
import { CLUSTER_DONE, LOADING_MAP, STREET_DONE, STREET_UNDONE, quip } from "@/lib/quips";
import { tourBridge } from "@/lib/tour-bridge";
import {
  OPENFREEMAP_STYLE,
  streetLinePaint,
  COLOR_MUTED,
  streetFeature,
  applyStreetState,
  applyStreetFilter,
  ROUTE_ARROW_PX,
  addMapOverlays,
  houseCirclePaint,
  eshkolLinePaint,
  lineVertices,
  fitHousePoints,
  type MapState,
} from "@/components/street-map/map-layers";
import { ClusterStreetList } from "@/components/street-map/ClusterStreetList";

type SearchStreet = {
  id: string;
  name_he: string;
  lat: number;
  lng: number;
  ashkol: string | null;
  done: boolean;
  near_settlement?: string | null;
  /** Cluster street list only: houses (addresses), apartments and voters on this line. */
  address_count?: number;
  door_count?: number;
  voter_count?: number;
};

type SearchCity = {
  name_he: string;
  lat: number;
  lng: number;
};

type EshkolHousePoint = {
  ashkol: string;
  street: string;
  house: number;
  lat: number;
  lng: number;
};

type EshkolStreetLine = {
  ashkol: string;
  street: string;
  streetId: string;
  geometry: { type: string; coordinates: unknown };
};

type AssignUser = { id: number; full_name: string; institution_id: number | null };

type MeUser = {
  id: number;
  role: string;
  full_name: string;
  institution_id: number | null;
};

type Institution = {
  id: number;
  name: string;
  settlement_name?: string | null;
  linked_clusters?: { ashkol: string }[] | string;
};
type PickableCoordinator = {
  id: number;
  full_name: string;
  email: string;
  institution_id: number | null;
};

function institutionOptionLabel(inst: Institution): string {
  let ashkols: string[] = [];
  const raw = inst.linked_clusters;
  if (Array.isArray(raw)) ashkols = raw.map((c) => String(c.ashkol)).filter(Boolean);
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as { ashkol: string }[];
      if (Array.isArray(parsed)) ashkols = parsed.map((c) => String(c.ashkol)).filter(Boolean);
    } catch {
      /* ignore */
    }
  }
  if (ashkols.length === 0) return inst.name;
  return `${inst.name} · אשכול ${ashkols.slice(0, 3).join(", ")}`;
}

type MapFocus = { lat: number; lng: number };

function fmtInt(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("he-IL") : "—";
}

function DirMark({ flip = false }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={flip ? "route-icon-flip" : undefined}>
      <path d="M12 3 L19 19 L12 15 L5 19 Z" fill="currentColor" />
    </svg>
  );
}

function TrimMark({ end }: { end: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className={end ? "route-icon-flip" : undefined}>
      <path d="M3 11 H13 V13 H3 Z" fill="currentColor" />
      <path d="M14 6 L22 12 L14 18 Z" fill="currentColor" />
    </svg>
  );
}

function keptRatios(keep: number, anchor: "start" | "end") {
  const span = Math.min(100, Math.max(0, keep)) / 100;
  if (anchor === "start") return { from: 0, to: span };
  return { from: 1 - span, to: 1 };
}

function portionFromSaved(from: number, to: number) {
  const middle = from > 0.01 && to < 0.99;
  if (middle) {
    return {
      keep: Math.round((to - from) * 100),
      anchor: "start" as const,
      frozen: { from, to },
    };
  }
  if (from <= 0.01) {
    return { keep: Math.round(to * 100), anchor: "start" as const, frozen: null };
  }
  return { keep: Math.round((1 - from) * 100), anchor: "end" as const, frozen: null };
}

function fmtPct(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
}

function clusterFromProps(p: Record<string, unknown>): ClusterView {
  return {
    ashkol: String(p.ashkol ?? ""),
    settlement_name: String(p.settlement_name ?? ""),
    bzb: Number(p.bzb ?? 0),
    voters: Number(p.voters ?? 0),
    valid: Number(p.valid ?? 0),
    right_votes: Number(p.right_votes ?? 0),
    turnout_pct: Number(p.turnout_pct ?? 0),
    right_pct: Number(p.right_pct ?? 0),
    ballot_count: Number(p.ballot_count ?? 0),
    likud_votes: Number(p.likud_votes ?? 0),
    likud_pct: Number(p.likud_pct ?? 0),
    map_lat: null,
    map_lng: null,
    linked: Number(p.linked ?? 0) === 1 || p.linked === true,
    done: Number(p.done ?? 0) === 1 || p.done === true,
  };
}

export function StreetMap({
  clusters,
  focus,
  focusAshkol,
  focusAshkolToken,
  onClusterDone,
}: {
  clusters: ClusterView[];
  focus?: MapFocus | null;
  /** Select this ashkol (e.g. from the coordinator table) and fly to it. */
  focusAshkol?: string | null;
  /** Bump to re-apply the same ashkol focus after another click. */
  focusAshkolToken?: number;
  /** Parent drops a finished cluster from the coordinator map. */
  onClusterDone?: (ashkol: string, done: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sidePanelRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const doneIdsRef = useRef<Set<string>>(new Set());
  const mapStateRef = useRef<MapState | null>(null);
  const setStreetDoneRef = useRef<(id: string, done: boolean) => void>(() => {});
  const commitStreetMarkRef = useRef<
    (street: SearchStreet, nextDone: boolean) => Promise<void>
  >(async () => {});
  const openStreetPanelRef = useRef<(id: string, name: string) => void>(() => {});
  const openDrawPanelRef = useRef<
    (next: { stage: number; draw: number; vertex: number | null; done: boolean }) => void
  >(() => {});
  const openStartRef = useRef<(lat: number, lng: number) => void>(() => {});
  const openClusterPanelRef = useRef<(cluster: ClusterView) => void>(() => {});
  const [q, setQ] = useState("");
  const [cityHits, setCityHits] = useState<SearchCity[]>([]);
  const [streetHits, setStreetHits] = useState<SearchStreet[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [parsedCity, setParsedCity] = useState<string | null>(null);
  const [activeHit, setActiveHit] = useState(0);
  const [status, setStatus] = useState<string>(LOADING_MAP[0]);
  const [selectedAshkol, setSelectedAshkol] = useState<string>("");
  const [housePoints, setHousePoints] = useState<EshkolHousePoint[]>([]);
  const [streetLines, setStreetLines] = useState<EshkolStreetLine[]>([]);
  const [houseSettlement, setHouseSettlement] = useState("");
  const [housesLoading, setHousesLoading] = useState(false);
  const selectedAshkolRef = useRef("");
  selectedAshkolRef.current = selectedAshkol;
  const pendingHouseFit = useRef("");
  const selectEshkolRef = useRef<(ashkol: string) => void>(() => {});
  const [picked, setPicked] = useState<ClusterView | null>(null);
  const [pickedStreet, setPickedStreet] = useState<SearchStreet | null>(null);
  const [assigned, setAssigned] = useState<AssignUser[]>([]);
  const [allowed, setAllowed] = useState<AssignUser[]>([]);
  const [assignId, setAssignId] = useState("");
  const [me, setMe] = useState<MeUser | null>(null);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [availableCoordinators, setAvailableCoordinators] = useState<
    PickableCoordinator[]
  >([]);
  const [linkInstitutionId, setLinkInstitutionId] = useState("");
  const [instQuery, setInstQuery] = useState("");
  const [instHitsOpen, setInstHitsOpen] = useState(false);
  const [activeInstHit, setActiveInstHit] = useState(0);
  const [linkCoordId, setLinkCoordId] = useState("");
  const [linkedInstitutionByAshkol, setLinkedInstitutionByAshkol] = useState<
    Record<string, number>
  >({});
  const [linkedOverride, setLinkedOverride] = useState<Set<string>>(() => new Set());
  const [mapState, setMapState] = useState<MapState | null>(null);
  /** Manual "סמן אשכול כבוצע" result, until a street in that cluster is toggled again. */
  const [doneOverride, setDoneOverride] = useState<Record<string, boolean>>({});
  /** Live street counts of a cluster whose street list was loaded here. */
  const [progressOverride, setProgressOverride] = useState<
    Record<string, { done: number; total: number }>
  >({});
  const [clusterStreets, setClusterStreets] = useState<SearchStreet[]>([]);
  const [clusterStreetsLoading, setClusterStreetsLoading] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const searchBoxRef = useRef<HTMLLabelElement | null>(null);
  const instComboRef = useRef<HTMLDivElement | null>(null);
  const [routeStages, setRouteStages] = useState<{ stage_no: number; hasPoint: boolean }[]>([]);
  const [activeStage, setActiveStage] = useState<number | null>(null);
  const routeStreetRef = useRef<
    Record<string, { reversed: boolean; from: number; to: number }>
  >({});
  const routeModeRef = useRef<RouteMode>("off");
  const routeApiRef = useRef<RouteApi | null>(null);
  const [routeMode, setRouteMode] = useState<RouteMode>("off");
  const [menuOpen, setMenuOpen] = useState(true);
  const [mapFull, setMapFull] = useState(false);
  const [pin, setPin] = useState<{ lng: number; lat: number } | null>(null);
  const [panel, setPanel] = useState<
    | {
        kind: "street";
        id: string;
        name: string;
        /** 0–100, how much of the street to keep. */
        keep: number;
        /** Which end the kept portion is anchored to. */
        anchor: "start" | "end";
        /** A middle slice already saved, until the slider or icon moves. */
        frozen: { from: number; to: number } | null;
        reversed: boolean;
        geometry: RouteGeometry | null;
      }
    | { kind: "start"; lat: number; lng: number; mode: "choose" | "collect" }
    | { kind: "cluster"; cluster: ClusterView }
    | { kind: "draw"; stage: number; draw: number; vertex: number | null; done: boolean }
    | null
  >(null);
  const [searchPlace, setSearchPlace] = useState("");
  const [routeFeatures, setRouteFeatures] = useState<Feature[]>([]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) setMe(data.user);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!me) return;
    fetch("/api/institutions")
      .then((r) => r.json())
      .then((data) => {
        const list = (data.institutions ?? []) as Institution[];
        setInstitutions(list);
        setAvailableCoordinators(
          (data.available_coordinators ?? []) as PickableCoordinator[],
        );
        if (me.role === "coordinator") {
          const preferred =
            list.find((i) => i.id === me.institution_id)?.id ?? list[0]?.id;
          if (preferred) {
            setLinkInstitutionId(String(preferred));
            const inst = list.find((i) => i.id === preferred);
            if (inst) setInstQuery(inst.name);
          }
        }
      })
      .catch(() => {});
  }, [me]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!instComboRef.current?.contains(e.target as Node)) {
        setInstHitsOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function loadStreetAssign(streetId: string) {
    const res = await fetch(`/api/streets/${encodeURIComponent(streetId)}/coordinators`);
    if (!res.ok) {
      setAssigned([]);
      setAllowed([]);
      return;
    }
    const data = await res.json();
    setAssigned(data.assigned ?? []);
    setAllowed(data.allowed ?? []);
    setAssignId("");
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current || mapFailed) return;

    function supportsWebGL(): boolean {
      try {
        const canvas = document.createElement("canvas");
        return Boolean(
          canvas.getContext("webgl2") || canvas.getContext("webgl"),
        );
      } catch {
        return false;
      }
    }

    if (!supportsWebGL()) {
      setMapFailed(true);
      setStatus("המפה לא זמינה — אין תמיכה ב-WebGL");
      return;
    }

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
      container: containerRef.current,
      style: OPENFREEMAP_STYLE,
      attributionControl: {
        customAttribution: "© OpenFreeMap © OpenMapTiles © OpenStreetMap",
      },
      center: [34.8, 31.5],
      zoom: 8,
    });
    } catch {
      setMapFailed(true);
      setStatus("המפה לא זמינה — אין תמיכה ב-WebGL");
      return;
    }

    map.addControl(new NavigationControl(), "top-left");
    let overlayBound = false;
    map.on("load", () => {
      if (!map.hasImage("place-pin")) {
        const w = 48;
        const h = 64;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const pin = canvas.getContext("2d");
        if (pin) {
          pin.clearRect(0, 0, w, h);
          pin.fillStyle = "#ea4335";
          pin.beginPath();
          pin.arc(24, 22, 16, Math.PI, 0);
          pin.quadraticCurveTo(40, 36, 24, 60);
          pin.quadraticCurveTo(8, 36, 8, 22);
          pin.closePath();
          pin.fill();
          pin.fillStyle = "#ffffff";
          pin.beginPath();
          pin.arc(24, 22, 7, 0, Math.PI * 2);
          pin.fill();
          map.addImage("place-pin", pin.getImageData(0, 0, w, h));
        }
      }
      if (!map.hasImage("route-dir")) {
        const size = ROUTE_ARROW_PX;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, size, size);
          ctx.fillStyle = "#111111";
          ctx.beginPath();
          ctx.moveTo(size / 2, 1);
          ctx.lineTo(size - 1, size - 2);
          ctx.lineTo(size / 2, size * 0.62);
          ctx.lineTo(1, size - 2);
          ctx.closePath();
          ctx.fill();
          map.addImage("route-dir", ctx.getImageData(0, 0, size, size), { pixelRatio: 1 });
        }
      }
      if (!map.hasImage("cluster-diamond")) {
        // SDF image: colored at render time by icon-color, outlined by icon-halo.
        const size = 28;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const pad = 5;
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.moveTo(size / 2, pad);
          ctx.lineTo(size - pad, size / 2);
          ctx.lineTo(size / 2, size - pad);
          ctx.lineTo(pad, size / 2);
          ctx.closePath();
          ctx.fill();
          map.addImage("cluster-diamond", ctx.getImageData(0, 0, size, size), { pixelRatio: 1, sdf: true });
        }
      }
      addMapOverlays(map);
      if (mapStateRef.current) applyStreetState(map, mapStateRef.current, doneIdsRef.current);
      applyStreetFilter(map, clustersRef.current.map((c) => c.ashkol));
      if (!overlayBound) {
        overlayBound = true;
        bindOverlayInteractions();
      }
      setStatus("");
    });
    map.on("error", (e) => {
      const msg = String(
        (e as { error?: { message?: string } }).error?.message ?? "",
      );
      if (/webgl|context lost|failed to initialize/i.test(msg)) {
        setMapFailed(true);
        setStatus("המפה לא זמינה — אין תמיכה ב-WebGL");
        try {
          map.remove();
        } catch {
          /* ignore */
        }
        mapRef.current = null;
      }
    });

    let routeClickHandled = false;
    let longFired = false;
    let startLong = false;
    let pressTimer: number | null = null;
    let pressAt: { x: number; y: number } | null = null;
    let pendingLeg: {
      stage: number;
      draw: number;
      coordinates: number[][];
      x: number;
      y: number;
    } | null = null;
    let clickTimer: number | null = null;
    let stretchFinishedAt = 0;
    let lastStreetTap: { id: string; time: number } | null = null;

    function clearPress() {
      if (pressTimer != null) window.clearTimeout(pressTimer);
      pressTimer = null;
      pressAt = null;
    }

    function openStagePopup(e: MapLayerMouseEvent) {
      const feature = e.features?.[0];
      const id = String(feature?.properties?.id ?? "");
      const name = String(feature?.properties?.name_he ?? "");
      if (!id) return;
      openStreetById(id, name || id);
    }

    function openStreetById(id: string, name: string) {
      longFired = true;
      if (clickTimer != null) window.clearTimeout(clickTimer);
      clickTimer = null;
      clearPress();
      openStreetPanelRef.current(id, name);
      window.setTimeout(() => map.stop(), 0);
    }

    function streetUnder(point: { x: number; y: number }) {
      if (!map.getLayer("eshkol-streets")) return null;
      const pad = 28;
      const hits = map.queryRenderedFeatures(
        [
          [point.x - pad, point.y - pad],
          [point.x + pad, point.y + pad],
        ],
        { layers: ["eshkol-streets"] },
      );
      const selected = selectedAshkolRef.current;
      const feature =
        hits.find(
          (hit) =>
            String(hit.properties?.ashkol ?? "") === selected &&
            String(hit.properties?.id ?? "") !== "",
        ) ?? hits.find((hit) => String(hit.properties?.id ?? "") !== "");
      if (!feature) return null;
      const id = String(feature.properties?.id ?? "");
      const name = String(feature.properties?.name_he ?? "");
      return id ? { id, name: name || id } : null;
    }

    function armPress(e: {
      point: { x: number; y: number };
      lngLat: MapLayerMouseEvent["lngLat"];
      features?: MapLayerMouseEvent["features"];
    }) {
      clearPress();
      longFired = false;
      pressAt = { x: e.point.x, y: e.point.y };
      const origin = e.lngLat;
      const feature = e.features?.[0];
      const kind = String(feature?.properties?.kind ?? "");
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        if (!feature) return;
        if (kind === "draw") {
          longFired = true;
          pendingLeg = null;
          if (!map.dragPan.isEnabled()) map.dragPan.enable();
          openDrawPanelRef.current({
            stage: Number(feature.properties?.stage),
            draw: Number(feature.properties?.draw),
            vertex: null,
            done: Number(feature.properties?.done) === 1,
          });
          return;
        }
        openStagePopup({
          ...e,
          lngLat: origin,
          features: [feature],
        } as MapLayerMouseEvent);
      }, 550);
    }

    async function markKnownStreet(id: string, name: string, lat: number, lng: number) {
      const done = Boolean(map.getFeatureState(streetFeature(id)).done);
      await commitStreetMarkRef.current(
        { id, name_he: name, lat, lng, ashkol: null, done },
        !done,
      );
    }

    function finishByDoubleClick(e: { preventDefault: () => void; originalEvent?: { preventDefault: () => void } }) {
      if (routeModeRef.current !== "stretch") return false;
      e.preventDefault();
      e.originalEvent?.preventDefault();
      if (clickTimer != null) window.clearTimeout(clickTimer);
      clickTimer = null;
      clearPress();
      pendingLeg = null;
      const closed = routeApiRef.current?.finishStretch() ?? false;
      if (closed) stretchFinishedAt = Date.now();
      if (closed || Date.now() - stretchFinishedAt > 400) {
        setStatus(closed ? "המסלול הסתיים" : "צריך עוד נקודה לפני סיום");
      }
      window.setTimeout(() => map.stop(), 0);
      return true;
    }

    function bindOverlayInteractions() {
    map.on("mousedown", "eshkol-streets", armPress);
    let stretchDrag: { stage: number; draw: number; vertex: number; moved: boolean } | null = null;
    let stretchMoved = false;

    function resumeDrawnRoute(feature: NonNullable<MapLayerMouseEvent["features"]>[number] | undefined, frame: boolean) {
      const kind = String(feature?.properties?.kind ?? "");
      if (kind !== "draw" && kind !== "handle" && kind !== "stretch-no" && kind !== "meter") return false;
      const stage = Number(feature?.properties?.stage);
      const draw = Number(feature?.properties?.draw);
      if (!Number.isFinite(stage) || !Number.isFinite(draw)) return false;
      routeModeRef.current = "stretch";
      map.doubleClickZoom.disable();
      routeApiRef.current?.editStretch(stage, draw, frame);
      return true;
    }

    function beginHandleDrag(e: {
      point: { x: number; y: number };
      preventDefault: () => void;
      features?: MapLayerMouseEvent["features"];
    }) {
      const feature = e.features?.[0];
      if (!feature || !resumeDrawnRoute(feature, false)) return;
      e.preventDefault();
      const stage = Number(feature.properties?.stage);
      const draw = Number(feature.properties?.draw);
      const vertex = Number(feature.properties?.vertex);
      const count = Number(feature.properties?.count);
      clearPress();
      longFired = false;
      stretchMoved = false;
      pressAt = { x: e.point.x, y: e.point.y };
      map.dragPan.disable();
      stretchDrag = { stage, draw, vertex, moved: false };
      if (vertex > 0 && vertex < count - 1) {
        pressTimer = window.setTimeout(() => {
          pressTimer = null;
          longFired = true;
          stretchDrag = null;
          map.dragPan.enable();
          openDrawPanelRef.current({
            stage,
            draw,
            vertex,
            done: false,
          });
        }, 550);
      }
    }
    map.on("mousedown", "draw-handle", beginHandleDrag);
    map.on("touchstart", "draw-handle", beginHandleDrag);

    function beginLine(e: {
      point: { x: number; y: number };
      lngLat: MapLayerMouseEvent["lngLat"];
      preventDefault: () => void;
      features?: MapLayerMouseEvent["features"];
    }) {
      const feature = e.features?.[0];
      const kind = String(feature?.properties?.kind ?? "");
      const onHandle =
        map.getLayer("draw-handle") != null &&
        map.queryRenderedFeatures([e.point.x, e.point.y], { layers: ["draw-handle"] }).length > 0;
      if (onHandle) return;
      if (kind === "draw" && feature?.geometry.type === "LineString" && resumeDrawnRoute(feature, false)) {
          e.preventDefault();
          pendingLeg = {
            stage: Number(feature.properties?.stage),
            draw: Number(feature.properties?.draw),
            coordinates: feature.geometry.coordinates as number[][],
            x: e.point.x,
            y: e.point.y,
          };
          map.dragPan.disable();
      }
      armPress(e);
    }
    map.on("mousedown", "route-line", beginLine);
    map.on("touchstart", "route-line", beginLine);
    map.on("mousedown", "route-casing", beginLine);
    map.on("touchstart", "route-casing", beginLine);
    map.on("contextmenu", "eshkol-streets", (e: MapLayerMouseEvent) => {
      e.preventDefault();
      clearPress();
      void openStagePopup(e);
    });
    map.on("dblclick", "eshkol-streets", (e: MapLayerMouseEvent) => {
      if (finishByDoubleClick(e)) return;
      e.preventDefault();
      if (clickTimer != null) window.clearTimeout(clickTimer);
      clickTimer = null;
      clearPress();
      void openStagePopup(e);
    });
    function editDrawnRoute(e: MapLayerMouseEvent) {
      const feature = e.features?.[0];
      if (!feature) return;
      if (!stretchMoved && !resumeDrawnRoute(feature, true)) return;
      routeClickHandled = true;
      setMenuOpen(true);
    }
    map.on("click", "route-line", editDrawnRoute);
    map.on("click", "route-casing", editDrawnRoute);
    map.on("click", "draw-handle", editDrawnRoute);
    map.on("click", "draw-end-label", editDrawnRoute);
    map.on("click", "draw-number", editDrawnRoute);
    map.on("click", "draw-meter", editDrawnRoute);
    function finishLineDoubleClick(e: MapLayerMouseEvent) {
      if (finishByDoubleClick(e)) return;
      e.preventDefault();
      if (clickTimer != null) window.clearTimeout(clickTimer);
      clickTimer = null;
      clearPress();
      void openStagePopup(e);
    }
    map.on("dblclick", "route-line", finishLineDoubleClick);
    map.on("dblclick", "route-casing", finishLineDoubleClick);
    function endStretchDrag() {
      pendingLeg = null;
      if (stretchDrag?.moved) {
        routeApiRef.current?.commitStretch();
        stretchMoved = true;
        window.setTimeout(() => {
          stretchMoved = false;
        }, 400);
      }
      stretchDrag = null;
      if (map.dragPan && !map.dragPan.isEnabled()) map.dragPan.enable();
    }
    const endPress = () => {
      endStretchDrag();
      clearPress();
    };
    map.on("mouseup", endPress);
    map.on("touchend", endPress);
    map.on("touchcancel", endPress);
    const movePress = (e: { point: { x: number; y: number }; lngLat: { lng: number; lat: number } }) => {
      if (pendingLeg && Math.hypot(e.point.x - pendingLeg.x, e.point.y - pendingLeg.y) > 8) {
        const leg = pendingLeg;
        pendingLeg = null;
        if (pressTimer != null) {
          window.clearTimeout(pressTimer);
          pressTimer = null;
        }
        const hit = closestInsert(leg.coordinates, e.lngLat.lng, e.lngLat.lat);
        if (hit) {
          const vertex =
            hit.t < 0.08
              ? hit.index
              : hit.t > 0.92
                ? hit.index + 1
                : routeApiRef.current?.insertStretchVertex(leg.stage, leg.draw, hit.index, hit.lng, hit.lat) ??
                  hit.index;
          stretchDrag = { stage: leg.stage, draw: leg.draw, vertex, moved: true };
        }
      }
      if (stretchDrag) {
        const dragged = pressAt != null && Math.hypot(e.point.x - pressAt.x, e.point.y - pressAt.y) > 4;
        if (dragged || stretchDrag.moved) {
          if (pressTimer != null) {
            window.clearTimeout(pressTimer);
            pressTimer = null;
          }
          stretchDrag = { ...stretchDrag, moved: true };
          routeApiRef.current?.moveStretchVertex(
            stretchDrag.stage,
            stretchDrag.draw,
            stretchDrag.vertex,
            e.lngLat.lng,
            e.lngLat.lat,
            false,
          );
        }
      } else if (pressAt && pressTimer != null && Math.hypot(e.point.x - pressAt.x, e.point.y - pressAt.y) > 40) {
        clearPress();
      }
    };
    map.on("mousemove", movePress);
    map.on("touchmove", movePress);

    map.on("click", "eshkol-streets", async (e: MapLayerMouseEvent) => {
      if (longFired) {
        longFired = false;
        return;
      }
      const mode = routeModeRef.current;
      if (mode === "stretch") return;
      if (mode === "street" || mode === "point") {
        routeClickHandled = true;
        const f = e.features?.[0];
        const id = String(f?.properties?.id ?? "");
        const name = String(f?.properties?.name_he ?? "");
        if (mode === "street" && id) {
          routeApiRef.current?.addStreet({ id, name_he: name || id });
        } else if (mode === "point") {
          routeApiRef.current?.addPoint(e.lngLat.lat, e.lngLat.lng);
        }
        return;
      }
      if (clickTimer != null) window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => {
        clickTimer = null;
        void markStreetDone(e);
      }, 280);
    });

    async function markStreetDone(e: MapLayerMouseEvent) {
      const f = e.features?.[0];
      if (!f) return;
      const id = String(f.properties?.id ?? f.id ?? "");
      const name = String(f.properties?.name_he ?? "");
      const ashkolRaw = f.properties?.ashkol;
      const ashkol =
        ashkolRaw != null && String(ashkolRaw).trim() !== ""
          ? String(ashkolRaw)
          : null;
      if (!id) return;
      const done = Boolean(map.getFeatureState(streetFeature(id)).done);
      await commitStreetMarkRef.current(
        { id, name_he: name, lat: e.lngLat.lat, lng: e.lngLat.lng, ashkol, done },
        !done,
      );
    }

    map.on("click", (e) => {
      if (
        map.getLayer("clusters-circle") &&
        map.queryRenderedFeatures(e.point, { layers: ["clusters-circle"] }).length > 0
      ) {
        return;
      }
      setPin({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      if (startLong) {
        startLong = false;
        return;
      }
      if (routeClickHandled) {
        routeClickHandled = false;
        return;
      }
      if (routeModeRef.current === "point") {
        setPin({ lng: e.lngLat.lng, lat: e.lngLat.lat });
        routeApiRef.current?.placeRoutePoint(e.lngLat.lat, e.lngLat.lng);
        return;
      }
      if (routeModeRef.current === "stretch") {
        if (stretchMoved) {
          stretchMoved = false;
          return;
        }
        const layers = ["draw-handle", "route-line", "clusters-circle", "route-point"].filter((id) =>
          map.getLayer(id),
        );
        const blocked = map.queryRenderedFeatures(e.point, { layers }).some((feature) => {
          const kind = String(feature.properties?.kind ?? "");
          const layer = feature.layer?.id;
          return (
            kind === "draw" ||
            kind === "handle" ||
            kind === "point" ||
            layer === "clusters-circle"
          );
        });
        if (blocked) return;
        if (clickTimer != null) window.clearTimeout(clickTimer);
        const lng = e.lngLat.lng;
        const lat = e.lngLat.lat;
        clickTimer = window.setTimeout(() => {
          clickTimer = null;
          routeApiRef.current?.stretchPoint(lng, lat);
        }, 280);
        return;
      }
      if (routeModeRef.current !== "off") return;
      if (map.queryRenderedFeatures(e.point, { layers: ["eshkol-streets", "route-line", "clusters-circle"].filter((id) => map.getLayer(id)) }).length > 0) {
        return;
      }
      const street = streetUnder(e.point);
      if (!street) return;
      if (clickTimer != null) window.clearTimeout(clickTimer);
      const lat = e.lngLat.lat;
      const lng = e.lngLat.lng;
      clickTimer = window.setTimeout(() => {
        clickTimer = null;
        void markKnownStreet(street.id, street.name, lat, lng);
      }, 280);
    });

    let clusterLong = false;
    let clusterTimer: number | null = null;
    function focusCluster(e: MapLayerMouseEvent) {
      const raw = e.features?.[0]?.properties;
      if (!raw) return;
      const cluster = clusterFromProps(raw as Record<string, unknown>);
      setPin(null);
      openClusterPanelRef.current(cluster);
      if (!pendingHouseFit.current) return;
      map.stop();
      map.flyTo({ center: [e.lngLat.lng, e.lngLat.lat], zoom: 14 });
    }
    const armClusterZoom = (e: {
      lngLat: MapLayerMouseEvent["lngLat"];
      features?: MapLayerMouseEvent["features"];
    }) => {
      clusterLong = false;
      if (clusterTimer != null) window.clearTimeout(clusterTimer);
      clusterTimer = window.setTimeout(() => {
        clusterTimer = null;
        clusterLong = true;
        focusCluster(e as MapLayerMouseEvent);
      }, 550);
    };
    map.on("mousedown", "clusters-circle", armClusterZoom);
    map.on("touchstart", "clusters-circle", armClusterZoom);
    const clearClusterTimer = () => {
      if (clusterTimer != null) window.clearTimeout(clusterTimer);
      clusterTimer = null;
    };
    map.on("mouseup", clearClusterTimer);
    map.on("touchend", clearClusterTimer);
    map.on("dblclick", "clusters-circle", (e: MapLayerMouseEvent) => {
      e.preventDefault();
      e.originalEvent.preventDefault();
      if (clusterTimer != null) window.clearTimeout(clusterTimer);
      clusterTimer = null;
      focusCluster(e);
    });
    map.on("click", "clusters-circle", (e: MapLayerMouseEvent) => {
      if (routeModeRef.current !== "off") return;
      if (clusterLong) {
        clusterLong = false;
        return;
      }
      focusCluster(e);
    });

    map.on("mouseenter", "eshkol-streets", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "eshkol-streets", () => {
      map.getCanvas().style.cursor = "";
    });
    map.on("mouseenter", "clusters-circle", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "clusters-circle", () => {
      map.getCanvas().style.cursor = "";
    });
    }

    function occupied(point: { x: number; y: number }) {
      if (streetUnder(point)) return true;
      if (!map.isStyleLoaded()) return false;
      const layers = ["clusters-circle", "route-point"].filter((id) => map.getLayer(id));
      if (layers.length === 0) return false;
      const pad = 18;
      return (
        map.queryRenderedFeatures(
          [
            [point.x - pad, point.y - pad],
            [point.x + pad, point.y + pad],
          ],
          { layers },
        ).length > 0
      );
    }
    map.on("touchstart", (e) => {
      const touches = (e.originalEvent as TouchEvent | undefined)?.touches?.length ?? 1;
      if (touches > 1) return;
      if (clickTimer != null) {
        window.clearTimeout(clickTimer);
        clickTimer = null;
      }
      const drawLayers = ["draw-handle", "route-line"].filter((id) => map.getLayer(id));
      if (
        drawLayers.length > 0 &&
        map
          .queryRenderedFeatures(
            [
              [e.point.x - 18, e.point.y - 18],
              [e.point.x + 18, e.point.y + 18],
            ],
            { layers: drawLayers },
          )
          .some((feature) => {
            const kind = String(feature.properties?.kind ?? "");
            return kind === "draw" || kind === "handle";
          })
      ) {
        return;
      }
      const street = streetUnder(e.point);
      if (!street) return;
      clearStart();
      clearPress();
      longFired = false;
      pressAt = { x: e.point.x, y: e.point.y };
      const held = street;
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        openStreetById(held.id, held.name);
      }, 550);
    });
    map.on("touchend", (e) => {
      if (longFired) {
        lastStreetTap = null;
        return;
      }
      const touches = (e.originalEvent as TouchEvent | undefined)?.touches?.length ?? 0;
      if (touches > 0) return;
      const street = streetUnder(e.point);
      const now = Date.now();
      if (
        street &&
        lastStreetTap &&
        now - lastStreetTap.time < 400 &&
        lastStreetTap.id === street.id
      ) {
        lastStreetTap = null;
        openStreetById(street.id, street.name);
        return;
      }
      lastStreetTap = street ? { id: street.id, time: now } : null;
      if (!street || routeModeRef.current !== "off") return;
      const held = street;
      const lat = e.lngLat.lat;
      const lng = e.lngLat.lng;
      clickTimer = window.setTimeout(() => {
        clickTimer = null;
        void markKnownStreet(held.id, held.name, lat, lng);
      }, 280);
    });
    let startTimer: number | null = null;
    let startAt: { x: number; y: number } | null = null;
    function clearStart() {
      if (startTimer != null) window.clearTimeout(startTimer);
      startTimer = null;
      startAt = null;
    }
    function armStart() {
      return;
    }
    map.on("mousedown", armStart);
    map.on("touchstart", armStart);
    map.on("mouseup", clearStart);
    map.on("touchend", clearStart);
    map.on("touchcancel", clearStart);
    map.on("mousemove", (e) => {
      if (!startAt || startTimer == null) return;
      if (Math.hypot(e.point.x - startAt.x, e.point.y - startAt.y) > 12) clearStart();
    });
    map.on("touchmove", (e) => {
      if (!startAt || startTimer == null) return;
      if (Math.hypot(e.point.x - startAt.x, e.point.y - startAt.y) > 12) clearStart();
    });
    map.on("dblclick", (e) => {
      if (finishByDoubleClick(e)) return;
    });

    mapRef.current = map;
    tourBridge.map = map;
    return () => {
      tourBridge.map = undefined;
      try {
        map.remove();
      } catch {
        /* already removed after WebGL failure */
      }
      mapRef.current = null;
    };
  }, []);

  /** One color per cluster, unique inside each town — the same color its streets and houses use. */
  const clusterColors = useMemo(() => {
    const byTown = new Map<string, string[]>();
    for (const c of clusters) {
      const list = byTown.get(c.settlement_name);
      if (list) list.push(c.ashkol);
      else byTown.set(c.settlement_name, [c.ashkol]);
    }
    const colors = new Map<string, string>();
    for (const list of byTown.values()) {
      for (const [ashkol, color] of eshkolColorMap(list)) colors.set(ashkol, color);
    }
    return colors;
  }, [clusters]);

  /** הושלם when every linked street is marked (or an admin marked the cluster); בתהליך once one is. */
  const clusterProgressOf = (c: ClusterView) => {
    const live = progressOverride[c.ashkol];
    const streetDone = live?.done ?? c.street_done ?? 0;
    const allStreets = live ? live.total > 0 && live.done === live.total : null;
    const done =
      doneOverride[c.ashkol] ??
      (allStreets === null ? Boolean(c.done) : allStreets || Boolean(c.ops_done));
    return { done, stage: clusterStage(done, streetDone) };
  };

  // Keep live counts for the selected cluster as its streets are marked.
  useEffect(() => {
    if (!selectedAshkol || clusterStreetsLoading) return;
    const total = clusterStreets.length;
    const done = clusterStreets.filter((s) => s.done).length;
    setProgressOverride((prev) => {
      const cur = prev[selectedAshkol];
      if (cur && cur.done === done && cur.total === total) return prev;
      return { ...prev, [selectedAshkol]: { done, total } };
    });
  }, [selectedAshkol, clusterStreets, clusterStreetsLoading]);

  // Marking the last street completes the cluster (and unmarking one reopens it).
  const lastDoneRef = useRef<Record<string, boolean>>({});
  const selectedCluster = clusters.find((c) => c.ashkol === selectedAshkol);
  const selectedComputedDone = selectedCluster ? clusterProgressOf(selectedCluster).done : false;
  useEffect(() => {
    if (!selectedAshkol || !progressOverride[selectedAshkol]) return;
    const prev = lastDoneRef.current[selectedAshkol];
    lastDoneRef.current[selectedAshkol] = selectedComputedDone;
    if (prev === undefined || prev === selectedComputedDone) return;
    onClusterDone?.(selectedAshkol, selectedComputedDone);
    if (selectedComputedDone) setStatus(`אשכול ${selectedAshkol}: ${quip(CLUSTER_DONE, Math.random() * 1e9)}`);
  }, [selectedAshkol, selectedComputedDone, progressOverride, onClusterDone]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const features = clusters
      .filter((c) => c.map_lat != null && c.map_lng != null)
      .map((c) => {
        const linked = Boolean(c.linked) || linkedOverride.has(c.ashkol);
        const { done, stage } = clusterProgressOf(c);
        return {
          type: "Feature" as const,
          properties: {
            ashkol: c.ashkol,
            settlement_name: c.settlement_name,
            bzb: c.bzb,
            voters: c.voters,
            valid: c.valid,
            right_votes: c.right_votes,
            turnout_pct: c.turnout_pct,
            right_pct: c.right_pct,
            ballot_count: c.ballot_count,
            likud_votes: c.likud_votes ?? 0,
            likud_pct: c.likud_pct ?? 0,
            linked: linked ? 1 : 0,
            done: done ? 1 : 0,
            stage: stage === "done" ? 2 : stage === "partial" ? 1 : 0,
            color: clusterColors.get(c.ashkol) ?? "#64748b",
            searched:
              searchPlace !== "" && c.settlement_name === searchPlace ? 1 : 0,
          },
          geometry: {
            type: "Point" as const,
            coordinates: [c.map_lng!, c.map_lat!],
          },
        };
      });
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      const src = map.getSource("clusters") as GeoJSONSource | undefined;
      if (!src) return;
      src.setData({ type: "FeatureCollection", features });
    };
    apply();
    map.on("load", apply);
    return () => {
      cancelled = true;
      map.off("load", apply);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clusterProgressOf reads these states
  }, [clusters, clusterColors, linkedOverride, doneOverride, progressOverride, searchPlace]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      if (!map.getLayer("clusters-selected")) return;
      map.setFilter("clusters-selected", ["==", ["get", "ashkol"], selectedAshkol]);
    };
    apply();
    map.on("load", apply);
    return () => {
      map.off("load", apply);
    };
  }, [selectedAshkol]);

  useEffect(() => {
    if (!picked) return;
    if (clusters.some((c) => c.ashkol === picked.ashkol)) return;
    setPicked(null);
    setSelectedAshkol("");
  }, [clusters, picked]);

  async function loadClusterStreets(ashkol: string) {
    if (!ashkol) {
      setClusterStreets([]);
      return;
    }
    setClusterStreetsLoading(true);
    try {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(ashkol)}/streets`,
      );
      if (!res.ok) {
        setClusterStreets([]);
        return;
      }
      const data = await res.json();
      setClusterStreets(data.streets ?? []);
    } finally {
      setClusterStreetsLoading(false);
    }
  }

  useEffect(() => {
    void loadClusterStreets(selectedAshkol);
  }, [selectedAshkol]);

  async function reloadMapState() {
    const res = await fetch("/api/map/state");
    if (!res.ok) return;
    const data = (await res.json()) as MapState;
    setMapState(data);
  }

  useEffect(() => {
    void reloadMapState();
  }, []);

  useEffect(() => {
    mapStateRef.current = mapState;
    const map = mapRef.current;
    if (!map || !mapState) return;
    const apply = () => applyStreetState(map, mapState, doneIdsRef.current);
    apply();
    if (!map.getLayer("streets-line")) map.once("idle", apply);
    // Drop a deferred apply from an older render, or it would repaint stale state later.
    return () => {
      map.off("idle", apply);
    };
  }, [mapState]);

  useEffect(() => {
    setStreetDoneRef.current = (id, done) => {
      const map = mapRef.current;
      if (map?.getSource("streets")) map.setFeatureState(streetFeature(id), { done });
      if (done) doneIdsRef.current.add(id);
      else doneIdsRef.current.delete(id);
      setMapState((prev) => {
        if (!prev) return prev;
        const ids = new Set(prev.doneStreetIds);
        if (done) ids.add(id);
        else ids.delete(id);
        return { ...prev, doneStreetIds: [...ids] };
      });
    };
    commitStreetMarkRef.current = async (street, nextDone) => {
      setPickedStreet({ ...street, done: street.done });
      void loadStreetAssign(street.id);
      setStatus(nextDone ? `מסמן בוצע: ${street.name_he}` : `מסיר סימון: ${street.name_he}`);
      const res = await fetch(`/api/streets/${encodeURIComponent(street.id)}/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: nextDone }),
      });
      if (!res.ok) {
        setStatus("שגיאה בסימון");
        return;
      }
      setStreetDoneRef.current(street.id, nextDone);
      setPickedStreet({ ...street, done: nextDone });
      setClusterStreets((list) =>
        list.map((s) => (s.id === street.id ? { ...s, done: nextDone } : s)),
      );
      setDoneOverride((prev) => {
        const a = selectedAshkolRef.current;
        if (!a || !(a in prev)) return prev;
        const next = { ...prev };
        delete next[a];
        return next;
      });
      setStatus(
        `${quip(nextDone ? STREET_DONE : STREET_UNDONE, Math.random() * 1e9)} · ${street.name_he}`,
      );
    };
  });

  async function markStreetsAlong(coordinates: number[][]) {
    const map = mapRef.current;
    if (!map?.getLayer("eshkol-streets")) return;
    const samples = coordinates.map((point) => [point[0]!, point[1]!] as [number, number]);
    for (const mark of arrowMarksEvery(coordinates, 30)) samples.push([mark.lng, mark.lat]);
    const counts = new Map<string, { name: string; n: number; lat: number; lng: number }>();
    for (const [lng, lat] of samples) {
      const point = map.project([lng, lat]);
      const hits = map.queryRenderedFeatures(
        [
          [point.x - 14, point.y - 14],
          [point.x + 14, point.y + 14],
        ],
        { layers: ["eshkol-streets"] },
      );
      const seen = new Set<string>();
      for (const hit of hits) {
        const id = String(hit.properties?.id ?? hit.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const prev = counts.get(id);
        counts.set(id, {
          name: String(hit.properties?.name_he ?? prev?.name ?? id),
          n: (prev?.n ?? 0) + 1,
          lat,
          lng,
        });
      }
    }
    for (const [id, info] of counts) {
      if (info.n < 2) continue;
      if (map.getFeatureState(streetFeature(id)).done) continue;
      await commitStreetMarkRef.current(
        { id, name_he: info.name, lat: info.lat, lng: info.lng, ashkol: null, done: false },
        true,
      );
    }
  }

  async function toggleStreetDone(street: SearchStreet, done: boolean) {
    setStatus(done ? `מסמן בוצע: ${street.name_he}` : `מסיר סימון: ${street.name_he}`);
    const res = await fetch(`/api/streets/${encodeURIComponent(street.id)}/mark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
    if (!res.ok) {
      setStatus("שגיאה בסימון");
      return;
    }
    setClusterStreets((list) =>
      list.map((s) => (s.id === street.id ? { ...s, done } : s)),
    );
    if (selectedAshkol) {
      setDoneOverride((prev) => {
        if (!(selectedAshkol in prev)) return prev;
        const next = { ...prev };
        delete next[selectedAshkol];
        return next;
      });
    }
    if (pickedStreet?.id === street.id) {
      setPickedStreet({ ...pickedStreet, done });
    }
    setStreetDoneRef.current(street.id, done);
    setStatus(`${quip(done ? STREET_DONE : STREET_UNDONE, Math.random() * 1e9)} · ${street.name_he}`);
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map || focus || selectedAshkol) return;
    const pts = clusters.filter((c) => c.map_lat != null && c.map_lng != null);
    if (pts.length === 0) return;
    const apply = () => {
      const lngs = pts.map((c) => c.map_lng!);
      const lats = pts.map((c) => c.map_lat!);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 40, maxZoom: 11 },
      );
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [clusters, focus, selectedAshkol]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const apply = () => {
      map.flyTo({ center: [focus.lng, focus.lat], zoom: 13 });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [focus]);

  const selectedSettlement =
    clusters.find((c) => c.ashkol === selectedAshkol)?.settlement_name ?? "";
  const houseQuery = selectedSettlement || searchPlace;

  const visibleHouses = useMemo(() => {
    const allowed = new Set(clusters.map((c) => c.ashkol));
    return housePoints.filter((house) => allowed.has(house.ashkol));
  }, [housePoints, clusters]);

  const visibleStreets = useMemo(() => {
    const allowed = new Set(clusters.map((c) => c.ashkol));
    return streetLines.filter((line) => allowed.has(line.ashkol));
  }, [streetLines, clusters]);

  /** One colour per cluster, assigned in ashkol order within each town. Streets and house dots share it. */

  const houseColors = useMemo(() => {
    const ashkols = [...new Set(visibleHouses.map((house) => house.ashkol))].sort((a, b) =>
      a.localeCompare(b, "en", { numeric: true }),
    );
    return new Map(ashkols.map((a) => [a, clusterColors.get(a) ?? "#64748b"] as [string, string]));
  }, [visibleHouses, clusterColors]);

  /** Street colours: each cluster's streets in its colour; done streets green; selection thickens. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const linked = new Set<string>([
      ...(mapState?.linkedAshkols ?? []),
      ...linkedOverride,
    ]);
    const paint = streetLinePaint(
      [...linked],
      selectedAshkol || "",
      pickedStreet?.id || "",
      clusterColors,
      clusterStreets.map((s) => s.id),
    );
    const apply = () => {
      if (!map.getLayer("streets-line")) return;
      map.setPaintProperty("streets-line", "line-color", paint["line-color"] as never);
      map.setPaintProperty("streets-line", "line-width", paint["line-width"] as never);
      map.setPaintProperty("streets-line", "line-opacity", paint["line-opacity"] as never);
    };
    apply();
    if (!map.getLayer("streets-line")) map.once("idle", apply);
    // Drop a deferred apply from an older render, or it would repaint stale state later.
    return () => {
      map.off("idle", apply);
    };
  }, [selectedAshkol, pickedStreet?.id, mapState, linkedOverride, clusterColors, clusterStreets]);

  /** Only streets of clusters on the current list are drawn. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ashkols = clusters.map((c) => c.ashkol);
    const apply = () => applyStreetFilter(map, ashkols);
    apply();
    if (!map.getLayer("streets-line")) map.once("idle", apply);
    // Drop a deferred apply from an older render, or it would repaint stale state later.
    return () => {
      map.off("idle", apply);
    };
  }, [clusters]);

  /** Legend: with a cluster selected, every cluster of that city (in its colour); otherwise the clusters whose houses are drawn. */
  const houseLegend = useMemo(() => {
    const town = selectedAshkol
      ? clusters.find((c) => c.ashkol === selectedAshkol)?.settlement_name
      : undefined;
    if (!town) return [...houseColors.entries()].map(([ashkol, color]) => ({ ashkol, color }));
    return clusters
      .filter((c) => c.settlement_name === town)
      .map((c) => c.ashkol)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
      .map((ashkol) => ({ ashkol, color: clusterColors.get(ashkol) ?? "#64748b" }));
  }, [houseColors, selectedAshkol, clusters, clusterColors]);
  const legendTown = selectedAshkol
    ? clusters.find((c) => c.ashkol === selectedAshkol)?.settlement_name
    : undefined;

  const clustersRef = useRef(clusters);
  const visibleHousesRef = useRef(visibleHouses);
  const visibleStreetsRef = useRef(visibleStreets);
  const houseSettlementRef = useRef(houseSettlement);
  const housesLoadingRef = useRef(housesLoading);
  clustersRef.current = clusters;
  visibleHousesRef.current = visibleHouses;
  visibleStreetsRef.current = visibleStreets;
  houseSettlementRef.current = houseSettlement;
  housesLoadingRef.current = housesLoading;

  const fitAshkolHousesRef = useRef<(ashkol: string) => void>(() => {});
  fitAshkolHousesRef.current = (ashkol: string) => {
    pendingHouseFit.current = ashkol;
    if (housesLoadingRef.current) return;
    const map = mapRef.current;
    const cluster = clustersRef.current.find((c) => c.ashkol === ashkol);
    if (!map || !cluster || houseSettlementRef.current !== cluster.settlement_name) return;
    pendingHouseFit.current = "";
    const linePoints = visibleStreetsRef.current
      .filter((line) => line.ashkol === ashkol)
      .flatMap((line) => lineVertices(line.geometry));
    const mine = visibleHousesRef.current.filter((house) => house.ashkol === ashkol);
    const apply = () => {
      map.stop();
      if (fitHousePoints(map, linePoints)) return;
      if (fitHousePoints(map, mine)) return;
      if (cluster.map_lng != null && cluster.map_lat != null) {
        map.flyTo({ center: [cluster.map_lng, cluster.map_lat], zoom: 14 });
      }
    };
    if (map.getSource("eshkol-streets")) apply();
    else map.once("idle", apply);
  };
  selectEshkolRef.current = (ashkol: string) => {
    const cluster = clustersRef.current.find((c) => c.ashkol === ashkol) ?? null;
    setSelectedAshkol(ashkol);
    if (cluster) {
      setPicked(cluster);
      setPanel({ kind: "cluster", cluster });
    }
    fitAshkolHousesRef.current(ashkol);
  };

  useEffect(() => {
    if (!houseQuery) {
      setHousePoints([]);
      setStreetLines([]);
      setHouseSettlement("");
      return;
    }
    let cancel = false;
    setHousesLoading(true);
    setHousePoints([]);
    setStreetLines([]);
    setHouseSettlement("");
    const encoded = encodeURIComponent(houseQuery);
    Promise.all([
      fetch(`/api/settlements/${encoded}/eshkol-houses`).then(async (res) => {
        if (!res.ok) return [] as EshkolHousePoint[];
        const data = (await res.json()) as { houses?: EshkolHousePoint[] };
        return data.houses ?? [];
      }),
      fetch(`/api/settlements/${encoded}/eshkol-streets`).then(async (res) => {
        if (!res.ok) return [] as EshkolStreetLine[];
        const data = (await res.json()) as { streets?: EshkolStreetLine[] };
        return data.streets ?? [];
      }),
    ])
      .then(([houses, streets]) => {
        if (cancel) return;
        setHousePoints(houses);
        setStreetLines(streets);
        setHouseSettlement(houseQuery);
      })
      .catch(() => {
        if (cancel) return;
        setHousePoints([]);
        setStreetLines([]);
        setHouseSettlement(houseQuery);
      })
      .finally(() => {
        if (!cancel) setHousesLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [houseQuery]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const features = visibleHouses.map((house) => ({
      type: "Feature" as const,
      properties: {
        ashkol: house.ashkol,
        street: house.street,
        house: house.house,
        color: houseColors.get(house.ashkol) ?? clusterColors.get(house.ashkol) ?? "#64748b",
      },
      geometry: { type: "Point" as const, coordinates: [house.lng, house.lat] },
    }));
    let cancelled = false;
    let tries = 0;
    const apply = () => {
      if (cancelled) return;
      const src = map.getSource("eshkol-houses") as GeoJSONSource | undefined;
      if (!src) {
        if (tries++ >= 30) return;
        map.once("idle", apply);
        return;
      }
      src.setData({ type: "FeatureCollection", features });
    };
    apply();
    return () => {
      cancelled = true;
      map.off("idle", apply);
    };
  }, [visibleHouses, houseColors, clusterColors]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const features = visibleStreets.map((line) => ({
      type: "Feature" as const,
      properties: {
        id: line.streetId,
        name_he: line.street,
        ashkol: line.ashkol,
        street: line.street,
        color: clusterColors.get(line.ashkol) ?? "#64748b",
      },
      geometry: line.geometry as Geometry,
    }));
    let cancelled = false;
    let tries = 0;
    const apply = () => {
      if (cancelled) return;
      const src = map.getSource("eshkol-streets") as GeoJSONSource | undefined;
      if (!src) {
        if (tries++ >= 30) return;
        map.once("idle", apply);
        return;
      }
      src.setData({ type: "FeatureCollection", features });
    };
    apply();
    return () => {
      cancelled = true;
      map.off("idle", apply);
    };
  }, [visibleStreets, clusterColors]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const paint = eshkolLinePaint(selectedAshkol, mapState?.doneStreetIds ?? []);
    let cancelled = false;
    let tries = 0;
    const apply = () => {
      if (cancelled) return;
      if (!map.getLayer("eshkol-streets")) {
        if (tries++ >= 30) return;
        map.once("idle", apply);
        return;
      }
      map.setPaintProperty("eshkol-streets", "line-color", paint["line-color"] as never);
      map.setPaintProperty("eshkol-streets", "line-width", paint["line-width"] as never);
      map.setPaintProperty("eshkol-streets", "line-opacity", paint["line-opacity"] as never);
      map.setLayoutProperty(
        "eshkol-streets",
        "line-sort-key",
        ["case", ["==", ["get", "ashkol"], selectedAshkol || "\u0000"], 2, 1] as never,
      );
    };
    apply();
    return () => {
      cancelled = true;
      map.off("idle", apply);
    };
  }, [selectedAshkol, mapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const paint = houseCirclePaint(selectedAshkol);
    const apply = () => {
      if (!map.getLayer("eshkol-houses")) return;
      map.setPaintProperty("eshkol-houses", "circle-radius", paint["circle-radius"] as never);
      map.setPaintProperty("eshkol-houses", "circle-color", paint["circle-color"] as never);
      map.setPaintProperty("eshkol-houses", "circle-opacity", paint["circle-opacity"] as never);
      map.setPaintProperty("eshkol-houses", "circle-stroke-width", paint["circle-stroke-width"] as never);
      map.setPaintProperty("eshkol-houses", "circle-stroke-color", paint["circle-stroke-color"] as never);
    };
    apply();
    if (!map.getLayer("eshkol-houses")) map.once("idle", apply);
    // Drop a deferred apply from an older render, or it would repaint stale state later.
    return () => {
      map.off("idle", apply);
    };
  }, [selectedAshkol]);

  useEffect(() => {
    if (!pendingHouseFit.current) return;
    fitAshkolHousesRef.current(pendingHouseFit.current);
  }, [houseSettlement, housesLoading, visibleHouses, visibleStreets]);

  /** Table / external ashkol pick — select the cluster and frame its houses. */
  useEffect(() => {
    if (!focusAshkol) return;
    const cluster = clusters.find((c) => c.ashkol === focusAshkol) ?? null;
    setSelectedAshkol(focusAshkol);
    setPicked(cluster);
    fitAshkolHousesRef.current(focusAshkol);
  }, [focusAshkol, focusAshkolToken, clusters]);

  function showStage(points: [number, number][]) {
    const map = mapRef.current;
    if (!map || points.length === 0) return;
    const apply = () => {
      if (points.length === 1) {
        map.flyTo({ center: points[0]!, zoom: 16 });
        return;
      }
      const lngs = points.map((p) => p[0]);
      const lats = points.map((p) => p[1]);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 80, maxZoom: 16 },
      );
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const id = window.requestAnimationFrame(() => map.resize());
    return () => window.cancelAnimationFrame(id);
  }, [mapFull]);

  useEffect(() => {
    routeModeRef.current = routeMode;
    const map = mapRef.current;
    if (!map) return;
    if (routeMode === "stretch") map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [routeMode]);

  useEffect(() => {
    function leaveMarking(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".street-map-canvas")) return;
      if (target.closest(".route-icon-row")) return;
      if (target.closest(".route-resume")) return;
      setRouteMode("off");
    }
    document.addEventListener("pointerdown", leaveMarking);
    return () => document.removeEventListener("pointerdown", leaveMarking);
  }, []);

  useEffect(() => {
    setRouteMode("off");
    routeModeRef.current = "off";
  }, [selectedAshkol]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource("route") as GeoJSONSource | undefined;
      src?.setData({ type: "FeatureCollection", features: routeFeatures });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [routeFeatures]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource("pin") as GeoJSONSource | undefined;
      if (!src) return;
      if (!pin) {
        src.setData({ type: "FeatureCollection", features: [] });
        return;
      }
      src.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [pin.lng, pin.lat] },
          },
        ],
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [pin]);

  const isCoordinator = me?.role === "coordinator";

  useEffect(() => {
    if (!isCoordinator) return;
    if (clusters.length === 0) {
      if (selectedAshkol) {
        setSelectedAshkol("");
        setPicked(null);
      }
      return;
    }
    if (clusters.some((c) => c.ashkol === selectedAshkol)) return;
    // Start on a cluster that still has work; a done one only if all are done.
    const next = clusters.find((c) => !c.done) ?? clusters[0]!;
    setSelectedAshkol(next.ashkol);
    setPicked(next);
    if (next.map_lng == null || next.map_lat == null) return;
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.flyTo({ center: [next.map_lng!, next.map_lat!], zoom: 14 });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [isCoordinator, clusters, selectedAshkol]);

  useEffect(() => {
    if (q.trim().length < 1) {
      setCityHits([]);
      setStreetHits([]);
      setParsedCity(null);
      setSearchBusy(false);
      return;
    }
    setSearchBusy(true);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/streets/search?q=${encodeURIComponent(q.trim())}`);
      if (!res.ok) {
        setSearchBusy(false);
        return;
      }
      const data = await res.json();
      setCityHits(data.cities ?? []);
      setStreetHits(data.streets ?? data.results ?? []);
      setParsedCity(data.parsed?.city ?? null);
      setActiveHit(0);
      setSearchOpen(true);
      setSearchBusy(false);
    }, 120);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!searchBoxRef.current?.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function clearHits() {
    setCityHits([]);
    setStreetHits([]);
    setSearchOpen(false);
    setParsedCity(null);
  }

  function goToCity(city: SearchCity) {
    const map = mapRef.current;
    if (!map) return;
    setSearchPlace(city.name_he);
    const match = clusters.find((c) => c.settlement_name === city.name_he);
    if (match) {
      setSelectedAshkol(match.ashkol);
      setPicked(match);
      setPanel({ kind: "cluster", cluster: match });
      fitAshkolHousesRef.current(match.ashkol);
    } else {
      setSelectedAshkol("");
      setPicked(null);
      setPanel(null);
    }
    map.flyTo({ center: [city.lng, city.lat], zoom: 13 });
    setQ(`${city.name_he} `);
    clearHits();
    setSearchOpen(true);
    setStatus(`עיר: ${city.name_he} · המשיכו להקליד שם רחוב`);
  }

  async function goToStreet(hit: SearchStreet) {
    const map = mapRef.current;
    if (!map) return;
    if (hit.near_settlement) {
      setSearchPlace(hit.near_settlement);
      const match = clusters.find((c) => c.settlement_name === hit.near_settlement);
      if (match) {
        setSelectedAshkol(match.ashkol);
        setPicked(match);
      }
    }
    map.flyTo({ center: [hit.lng, hit.lat], zoom: 15 });
    setQ(
      hit.near_settlement
        ? `${hit.near_settlement} ${hit.name_he}`
        : hit.name_he,
    );
    clearHits();
    setPickedStreet(hit);
    void loadStreetAssign(hit.id);
    setPanel(null);

    const pad = 0.01;
    const res = await fetch(
      `/api/streets?west=${hit.lng - pad}&south=${hit.lat - pad}&east=${hit.lng + pad}&north=${hit.lat + pad}&limit=50`,
    );
    if (!res.ok) return;
    const fc = await res.json();
    const match = (fc.features as Feature[]).find(
      (f) => f.properties?.id === hit.id,
    );
    const src = map.getSource("highlight") as GeoJSONSource;
    src?.setData({
      type: "FeatureCollection",
      features: match ? [match] : [],
    });
    setStatus(`נמצא: ${hit.name_he}${hit.done ? " (בוצע)" : ""}`);
  }

  async function assignCoordinator() {
    if (!pickedStreet || !assignId) return;
    setStatus("מוסיף לרכז…");
    const res = await fetch(
      `/api/streets/${encodeURIComponent(pickedStreet.id)}/coordinators`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: Number(assignId) }),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || "שגיאה בהוספה לרכז");
      return;
    }
    setStatus("הרחוב נוסף לרכז");
    await loadStreetAssign(pickedStreet.id);
  }

  async function removeCoordinator(userId: number) {
    if (!pickedStreet) return;
    const res = await fetch(
      `/api/streets/${encodeURIComponent(pickedStreet.id)}/coordinators?user_id=${userId}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const data = await res.json();
      setStatus(data.error || "שגיאה בהסרה");
      return;
    }
    setStatus("השיוך הוסר");
    await loadStreetAssign(pickedStreet.id);
  }

  async function linkClusterToInstitution() {
    if (!picked) return;
    const institutionId = Number(linkInstitutionId) || me?.institution_id;
    if (!institutionId) {
      setStatus("בחרו מוסד מהרשימה לקישור האשכול");
      return;
    }
    const instName =
      institutions.find((i) => i.id === institutionId)?.name ?? "המוסד";
    setStatus("מקשר אשכול למוסד…");
    const res = await fetch(`/api/institutions/${institutionId}/clusters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ashkol: picked.ashkol }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || "שגיאה בקישור אשכול");
      return;
    }
    setStatus(`✓ הקישור הצליח — אשכול ${picked.ashkol} קושר ל«${instName}». אפשר לקשר רכז למוסד.`);
    setPicked({ ...picked, linked: true });
    setLinkedOverride((prev) => new Set(prev).add(picked.ashkol));
    setLinkedInstitutionByAshkol((prev) => ({
      ...prev,
      [picked.ashkol]: institutionId,
    }));
    setLinkCoordId("");
    setInstHitsOpen(false);
    void reloadMapState();
  }

  async function linkCoordinatorToInstitution() {
    const ashkol = picked?.ashkol;
    const institutionId =
      (ashkol ? linkedInstitutionByAshkol[ashkol] : undefined) ||
      Number(linkInstitutionId) ||
      me?.institution_id;
    const userId = Number(linkCoordId);
    if (!institutionId || !Number.isInteger(userId)) {
      setStatus("בחרו רכז לקישור למוסד");
      return;
    }
    const coord = availableCoordinators.find((c) => c.id === userId);
    const instName =
      institutions.find((i) => i.id === institutionId)?.name ?? "המוסד";
    setStatus("מקשר רכז למוסד…");
    const res = await fetch(`/api/institutions/${institutionId}/coordinators`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || "שגיאה בקישור רכז");
      return;
    }
    setStatus(
      `✓ הרכז ${coord?.full_name ?? ""} קושר ל«${instName}»`,
    );
    setLinkCoordId("");
  }

  async function markClusterStreets(done: boolean) {
    if (!selectedAshkol) return;
    const ashkol = selectedAshkol;
    setStatus(done ? "מסמן את האשכול כבוצע…" : "מסיר את סימון האשכול…");
    const admin = me?.role === "super_admin" || me?.role === "area_manager";
    const res = admin
      ? await fetch("/api/team/clusters/mark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ashkol, done }),
        })
      : await fetch(`/api/clusters/${encodeURIComponent(ashkol)}/mark-streets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ done }),
        });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data.error || "שגיאה בעדכון האשכול");
      return;
    }
    setDoneOverride((prev) => ({ ...prev, [ashkol]: done }));
    if (picked?.ashkol === ashkol) {
      setPicked({ ...picked, done });
    }
    onClusterDone?.(ashkol, done);
    if (admin) {
      const streets = Number(data.streetsUpdated ?? 0);
      setStatus(
        done
          ? streets > 0
            ? `אשכול ${ashkol} סומן כבוצע, כולל ${streets} רחובות`
            : `אשכול ${ashkol} סומן כבוצע`
          : `אשכול ${ashkol} סומן כלא בוצע`,
      );
    } else if (data.updated) {
      setStatus(
        `${done ? "סומנו" : "הוסרו"} ${data.updated} רחובות באשכול ${ashkol}`,
      );
    } else {
      setStatus(
        data.message ||
          (done
            ? `אשכול ${ashkol} סומן כבוצע`
            : "אין רחובות מקושרים לאשכול (ממתינים לקובץ קישור)"),
      );
    }
    void reloadMapState();
    if (ashkol) void loadClusterStreets(ashkol);
  }

  type HitItem =
    | { kind: "city"; city: SearchCity }
    | { kind: "street"; street: SearchStreet };
  const hitItems: HitItem[] = [
    ...cityHits.map((city) => ({ kind: "city" as const, city })),
    ...streetHits.map((street) => ({ kind: "street" as const, street })),
  ];
  const showHits = searchOpen && (hitItems.length > 0 || searchBusy || q.trim().length >= 1);
  // Coordinators link clusters from the institutions flow / map without a button —
  // «קשר למוסד» is admin/manager only.
  const canLinkCluster =
    me && (me.role === "super_admin" || me.role === "area_manager");

  const filteredInstitutions = institutions
    .filter((i) => {
      if (!instQuery.trim()) return true;
      const hay = `${i.name} ${i.settlement_name ?? ""} ${institutionOptionLabel(i)}`;
      return matchesSearch(hay, instQuery);
    })
    .slice(0, 40);

  const selectedInstitution =
    institutions.find((i) => String(i.id) === linkInstitutionId) ?? null;

  const linkedInstIdForPicked = picked
    ? linkedInstitutionByAshkol[picked.ashkol] ??
      (Number(linkInstitutionId) || null)
    : null;

  const showCoordLink =
    Boolean(canLinkCluster && picked && linkedInstIdForPicked);

  function pickInstitution(inst: Institution) {
    setLinkInstitutionId(String(inst.id));
    setInstQuery(inst.name);
    setInstHitsOpen(false);
    setActiveInstHit(0);
  }

  function onInstKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!instHitsOpen || filteredInstitutions.length === 0) {
      if (e.key === "Escape") setInstHitsOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveInstHit((i) => (i + 1) % filteredInstitutions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveInstHit(
        (i) => (i - 1 + filteredInstitutions.length) % filteredInstitutions.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = filteredInstitutions[activeInstHit];
      if (hit) pickInstitution(hit);
    } else if (e.key === "Escape") {
      setInstHitsOpen(false);
    }
  }

  function activateHit(index: number) {
    const item = hitItems[index];
    if (!item) return;
    if (item.kind === "city") goToCity(item.city);
    else void goToStreet(item.street);
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!showHits || hitItems.length === 0) {
      if (e.key === "Escape") setSearchOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveHit((i) => (i + 1) % hitItems.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveHit((i) => (i - 1 + hitItems.length) % hitItems.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      activateHit(activeHit);
    } else if (e.key === "Escape") {
      setSearchOpen(false);
    }
  }

  function markMatch(text: string) {
    const parts = q.trim().split(/\s+/).filter(Boolean);
    const needle = parts[parts.length - 1] || "";
    if (!needle) return text;
    const lower = text.toLowerCase();
    const n = needle.toLowerCase();
    let idx = lower.indexOf(n);
    if (idx < 0) {
      const softNeedle = n.replace(/['׳״"`]/g, "");
      const softText = lower.replace(/['׳״"`]/g, "");
      const softIdx = softText.indexOf(softNeedle);
      if (softIdx < 0 || !softNeedle) return text;
      // Map soft index back roughly onto original by scanning.
      idx = 0;
      let softPos = 0;
      while (idx < text.length && softPos < softIdx) {
        if (!/['׳״"`]/.test(text[idx]!)) softPos += 1;
        idx += 1;
      }
      const endSoft = softIdx + softNeedle.length;
      let end = idx;
      let softEndPos = softPos;
      while (end < text.length && softEndPos < endSoft) {
        if (!/['׳״"`]/.test(text[end]!)) softEndPos += 1;
        end += 1;
      }
      return (
        <>
          {text.slice(0, idx)}
          <mark>{text.slice(idx, end)}</mark>
          {text.slice(end)}
        </>
      );
    }
    return (
      <>
        {text.slice(0, idx)}
        <mark>{text.slice(idx, idx + needle.length)}</mark>
        {text.slice(idx + needle.length)}
      </>
    );
  }

  openStartRef.current = () => {
    // The start/collection card is not used. The point icon places the point.
  };
  openDrawPanelRef.current = (next) => {
    setPanel({ kind: "draw", ...next });
  };
  openStreetPanelRef.current = () => {
    // The street length card is not the route. A press on a street must not open it.
  };
  openClusterPanelRef.current = (cluster) => {
    setSelectedAshkol(cluster.ashkol);
    setPicked(cluster);
    setPanel({ kind: "cluster", cluster });
    fitAshkolHousesRef.current(cluster.ashkol);
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("highlight") as GeoJSONSource | undefined;
    if (!src) return;
    if (panel?.kind !== "street") {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const ratios = panel.frozen ?? keptRatios(panel.keep, panel.anchor);
    const sliced = directedGeometry(
      spanOf(panel.geometry, ratios.from, ratios.to),
      panel.reversed,
    );
    src.setData({
      type: "FeatureCollection",
      features: sliced ? [{ type: "Feature", properties: {}, geometry: sliced }] : [],
    });
  }, [panel]);

  function showAllClusters() {
    const map = mapRef.current;
    if (!map) return;
    const pts = clusters.filter((c) => c.map_lat != null && c.map_lng != null);
    if (pts.length === 0) return;
    const lngs = pts.map((c) => c.map_lng!);
    const lats = pts.map((c) => c.map_lat!);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 40, maxZoom: 11 },
    );
  }

  function saveStartPoint() {
    if (panel?.kind !== "start") return;
    if (!routeApiRef.current) {
      setStatus("בחרו אשכול כדי לשמור נקודה");
      return;
    }
    routeApiRef.current.addStartPoint(panel.lat, panel.lng);
    setPanel(null);
    setStatus("נקודת התחלה נשמרה");
  }

  function saveCollectionPoint(stageNo: number | "new") {
    if (panel?.kind !== "start") return;
    if (!routeApiRef.current) {
      setStatus("בחרו אשכול כדי לשמור נקודה");
      return;
    }
    if (stageNo === "new") routeApiRef.current.addCollectionPoint(panel.lat, panel.lng);
    else routeApiRef.current.setStagePoint(stageNo, panel.lat, panel.lng);
    setPanel(null);
    setStatus("נקודת קיבוץ נשמרה");
  }

  function addPanelStreet(stage: number | "new") {
    if (panel?.kind !== "street") return;
    const ratios = panel.frozen ?? keptRatios(panel.keep, panel.anchor);
    const street = {
      id: panel.id,
      name_he: panel.name,
      from_ratio: ratios.from,
      to_ratio: ratios.to,
      reversed: panel.reversed,
    };
    if (stage === "new") routeApiRef.current?.addStreetToNewStage(street);
    else routeApiRef.current?.addStreetToStage(street, stage);
    setPanel(null);
  }

  const selectedDone = selectedComputedDone;

  // Clicking on the map brings it to the middle of the screen and keeps it there.
  useMapFocus(stageRef, wrapRef);
  // The cluster info box closes on any click outside it.
  const closeInfoBox = useCallback(() => setPanel((p) => (p?.kind === "cluster" ? null : p)), []);
  useCloseOnOutsideClick(sidePanelRef, panel?.kind === "cluster", closeInfoBox);

  // Handles for the guided tour ("do it for me" and undo at the end).
  tourBridge.selectedAshkol = selectedAshkol;
  tourBridge.tourAshkol = () =>
    [...clusters].sort((a, b) => (b.street_total ?? 0) - (a.street_total ?? 0))[0]?.ashkol;
  tourBridge.refreshStreets = () => {
    const a = selectedAshkolRef.current;
    if (a) void loadClusterStreets(a);
    void reloadMapState();
  };

  const sidePanel = panel ? (
    <aside className="map-side-panel" aria-live="polite" ref={sidePanelRef}>
      <button type="button" className="map-side-close" onClick={() => setPanel(null)} aria-label="סגור">
        ×
      </button>
      {panel.kind === "cluster" ? (
        <>
          <strong>{panel.cluster.settlement_name}</strong>
          <p>אשכול <bdi dir="ltr">{panel.cluster.ashkol}</bdi></p>
          <ul>
            <li>בז״ב <bdi dir="ltr">{fmtInt(panel.cluster.bzb)}</bdi></li>
            <li>מצביעים <bdi dir="ltr">{fmtInt(panel.cluster.voters)}</bdi></li>
            <li>הצבעה <bdi dir="ltr">{fmtPct(panel.cluster.turnout_pct)}</bdi></li>
            <li>ימין <bdi dir="ltr">{fmtPct(panel.cluster.right_pct)}</bdi></li>
            <li>קלפיות <bdi dir="ltr">{fmtInt(panel.cluster.ballot_count)}</bdi></li>
          </ul>
        </>
      ) : panel.kind === "draw" ? (
        <>
          <strong>{panel.vertex == null ? `מקטע ${panel.draw + 1}` : "פיצול מקטע"}</strong>
          <button
            type="button"
            className="route-icon-btn route-choice"
            onClick={() => {
              if (panel.vertex == null) {
                routeApiRef.current?.setStretchDone(panel.stage, panel.draw, !panel.done);
              } else {
                routeApiRef.current?.splitStretch(panel.stage, panel.draw, panel.vertex);
              }
              setPanel(null);
            }}
          >
            {panel.vertex == null ? (panel.done ? "בטל ביצוע" : "בוצע") : "פצל"}
          </button>
        </>
      ) : panel.kind === "start" ? (
        <>
          {panel.mode === "collect" ? (
            <>
              <strong>נקודת קיבוץ</strong>
              <div className="route-inline">
                {routeStages
                  .filter((stage) => stage.stage_no > 1 && stage.hasPoint)
                  .map((stage, index) => (
                    <button
                      key={stage.stage_no}
                      type="button"
                      className="route-icon-btn"
                      aria-label={`קיבוץ ${index + 1}`}
                      onClick={() => saveCollectionPoint(stage.stage_no)}
                    >
                      {index + 1}
                    </button>
                  ))}
                <button
                  type="button"
                  className="route-icon-btn"
                  aria-label="נקודת קיבוץ חדשה"
                  onClick={() => saveCollectionPoint("new")}
                >
                  +
                </button>
              </div>
            </>
          ) : (
            <div className="route-inline">
              <button type="button" className="route-icon-btn route-choice" aria-label="נקודת התחלה" onClick={saveStartPoint}>
                התחלה
              </button>
              <button
                type="button"
                className="route-icon-btn route-choice"
                aria-label="נקודת קיבוץ"
                onClick={() => {
                  const existing = routeStages.filter((stage) => stage.stage_no > 1 && stage.hasPoint);
                  if (existing.length === 0) {
                    saveCollectionPoint("new");
                    return;
                  }
                  setPanel((prev) => (prev?.kind === "start" ? { ...prev, mode: "collect" } : prev));
                }}
              >
                קיבוץ
              </button>
            </div>
          )}
          {!picked ? <p>בחרו אשכול כדי לשמור.</p> : null}
        </>
      ) : (
        <>
          <strong>{panel.name}</strong>
          <div className="route-inline">
            <label className="route-span">
              אורך <bdi dir="ltr">{panel.keep}%</bdi>
              <input
                type="range"
                min={0}
                max={100}
                value={panel.keep}
                onChange={(event) => {
                  const keep = Number(event.target.value);
                  setPanel((prev) =>
                    prev?.kind === "street" ? { ...prev, keep, frozen: null } : prev,
                  );
                }}
              />
            </label>
            <button
              type="button"
              className="route-icon-btn"
              aria-pressed={panel.anchor === "end"}
              aria-label={panel.anchor === "end" ? "הקיצור מההתחלה" : "הקיצור מהסוף"}
              onClick={() =>
                setPanel((prev) =>
                  prev?.kind === "street"
                    ? {
                        ...prev,
                        anchor: prev.anchor === "start" ? "end" : "start",
                        frozen: null,
                      }
                    : prev,
                )
              }
            >
              <TrimMark end={panel.anchor === "end"} />
            </button>
          </div>
          <div className="route-inline" role="group" aria-label="כיוון ההתקדמות">
            <span>כיוון</span>
            <button
              type="button"
              className="route-icon-btn"
              aria-pressed={!panel.reversed}
              aria-label="כיוון הרחוב"
              onClick={() =>
                setPanel((prev) => (prev?.kind === "street" ? { ...prev, reversed: false } : prev))
              }
            >
              <DirMark />
            </button>
            <button
              type="button"
              className="route-icon-btn"
              aria-pressed={panel.reversed}
              aria-label="כיוון הפוך"
              onClick={() =>
                setPanel((prev) => (prev?.kind === "street" ? { ...prev, reversed: true } : prev))
              }
            >
              <DirMark flip />
            </button>
          </div>
          <div className="route-inline route-stage-row">
            <button
              type="button"
              className="route-icon-btn route-stage-dot"
              style={{ background: stageColor(activeStage ?? routeStages[0]?.stage_no ?? 1) }}
              aria-label={
                activeStage
                  ? `הוסף לשלב ${activeStage}`
                  : routeStages[0]
                    ? `הוסף לשלב ${routeStages[0].stage_no}`
                    : "הוסף לשלב"
              }
              onClick={() => {
                const target =
                  routeStages.find((stage) => stage.stage_no === activeStage)?.stage_no ??
                  routeStages[0]?.stage_no;
                addPanelStreet(target ?? "new");
              }}
            />
            <button
              type="button"
              className="route-icon-btn route-choice"
              aria-label="שלב חדש"
              onClick={() => addPanelStreet("new")}
            >
              שלב חדש
            </button>
          </div>
        </>
      )}
    </aside>
  ) : null;

  return (
    <div className="street-map-wrap" ref={wrapRef}>
      <div className="street-map-toolbar">
        {me != null && me.role !== "coordinator" && (
        <label className="search-box" ref={searchBoxRef} data-tour="search">
          חיפוש עיר או רחוב
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={onSearchKeyDown}
            placeholder='עיר, רחוב, או שניהם — למשל בית שאן הרמב"ם'
            autoComplete="off"
            role="combobox"
            aria-expanded={showHits}
            aria-controls="map-search-hits"
            aria-autocomplete="list"
          />
          {showHits && (
            <ul id="map-search-hits" className="search-hits" role="listbox">
              {parsedCity && (
                <li className="search-hint">מזהה עיר: {parsedCity} · השלמת רחובות בעיר</li>
              )}
              {searchBusy && hitItems.length === 0 && (
                <li className="search-hint">מחפש השלמות…</li>
              )}
              {!searchBusy && hitItems.length === 0 && q.trim().length >= 1 && (
                <li className="search-hint">אין התאמות — נסו עיר ואז רחוב</li>
              )}
              {cityHits.length > 0 && (
                <li className="search-section">ערים</li>
              )}
              {cityHits.map((c, i) => (
                <li key={`city-${c.name_he}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={activeHit === i}
                    className={activeHit === i ? "active" : undefined}
                    onMouseEnter={() => setActiveHit(i)}
                    onClick={() => goToCity(c)}
                  >
                    <span className="hit-kind">עיר</span>
                    {markMatch(c.name_he)}
                  </button>
                </li>
              ))}
              {streetHits.length > 0 && (
                <li className="search-section">רחובות</li>
              )}
              {streetHits.map((h, i) => {
                const idx = cityHits.length + i;
                return (
                  <li key={h.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={activeHit === idx}
                      className={activeHit === idx ? "active" : undefined}
                      onMouseEnter={() => setActiveHit(idx)}
                      onClick={() => void goToStreet(h)}
                    >
                      <span className="hit-kind">רחוב</span>
                      {markMatch(h.name_he)}
                      {h.near_settlement ? (
                        <span className="hit-meta"> · {h.near_settlement}</span>
                      ) : null}
                      {h.done ? " ✓" : ""}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </label>
        )}
        <label data-tour="cluster-select">
          אשכול
          <select
            value={selectedAshkol}
            onChange={(e) => {
              const ashkol = e.target.value;
              if (ashkol) selectEshkolRef.current(ashkol);
              else {
                setSelectedAshkol("");
                setPicked(null);
                setPanel(null);
              }
            }}
          >
            {me?.role === "coordinator" ? null : (
              <option value="">בחרו אשכול</option>
            )}
            {clusters.map((c) => (
              <option key={c.ashkol} value={c.ashkol}>
                {c.settlement_name} · {c.ashkol}
                {` · ${CLUSTER_STAGE_LABEL[clusterProgressOf(c).stage]}`}
              </option>
            ))}
          </select>
        </label>
        {selectedAshkol && !selectedDone ? (
          <button
            type="button"
            className="export"
            data-tour="cluster-done"
            onClick={() => markClusterStreets(true)}
          >
            סמן אשכול כבוצע
          </button>
        ) : null}
        {selectedAshkol && selectedDone ? (
          <button
            type="button"
            className="map-quiet-btn"
            data-tour="cluster-done"
            onClick={() => markClusterStreets(false)}
          >
            ביטול סימון ביצוע
          </button>
        ) : null}
        <button type="button" className="map-quiet-btn" onClick={showAllClusters}>
          ⤢ כל האשכולות במפה
        </button>
        <p
          className={`map-status${/סומן כבוצע|✓|💎|🇮🇱/.test(status) ? " link-success-note" : ""}`}
          role="status"
        >
          {status}
        </p>
      </div>
      <div
        className={`map-side-cards${
          selectedAshkol && clusterStreets.length > 0 ? " has-streets" : ""
        }`}
      >
        <aside className="cluster-card" aria-live="polite" data-tour="cluster-card">
          {picked ? (
            <>
              <h2>
                <ShowMore text={picked.settlement_name} /> · אשכול{" "}
                <bdi dir="ltr">{picked.ashkol}</bdi>
              </h2>
              <div>
                <span>בז״ב</span>
                <strong><bdi dir="ltr">{fmtInt(picked.bzb)}</bdi></strong>
              </div>
              <div>
                <span>מצביעים</span>
                <strong><bdi dir="ltr">{fmtInt(picked.voters)}</bdi></strong>
              </div>
              <div>
                <span>כשרים</span>
                <strong><bdi dir="ltr">{fmtInt(picked.valid)}</bdi></strong>
              </div>
              <div>
                <span>קלפיות</span>
                <strong><bdi dir="ltr">{fmtInt(picked.ballot_count)}</bdi></strong>
              </div>
              <div>
                <span>הצבעה</span>
                <strong><bdi dir="ltr">{fmtPct(picked.turnout_pct)}</bdi></strong>
              </div>
              <div>
                <span>קולות ימין</span>
                <strong><bdi dir="ltr">{fmtInt(picked.right_votes)}</bdi></strong>
              </div>
              <div>
                <span>ימין</span>
                <strong><bdi dir="ltr">{fmtPct(picked.right_pct)}</bdi></strong>
              </div>
              <div>
                <span>קולות מחל</span>
                <strong><bdi dir="ltr">{fmtInt(picked.likud_votes ?? 0)}</bdi></strong>
              </div>
              <div>
                <span>מחל</span>
                <strong><bdi dir="ltr">{fmtPct(picked.likud_pct ?? 0)}</bdi></strong>
              </div>
              {canLinkCluster && (
                <div className="cluster-link-row">
                  <a
                    className="export"
                    href={`/team/clusters/${encodeURIComponent(picked.ashkol)}/sheet`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    דף PDF
                  </a>
                </div>
              )}
              {canLinkCluster && (
                <div className="cluster-link-block">
                  <div className="cluster-link-row cluster-link-combo" ref={instComboRef}>
                    <label className="inst-combo">
                      מוסד לקישור
                      <input
                        type="search"
                        value={instQuery}
                        onChange={(e) => {
                          setInstQuery(e.target.value);
                          setLinkInstitutionId("");
                          setInstHitsOpen(true);
                          setActiveInstHit(0);
                        }}
                        onFocus={() => setInstHitsOpen(true)}
                        onKeyDown={onInstKeyDown}
                        placeholder="הקלידו שם מוסד…"
                        autoComplete="off"
                        role="combobox"
                        aria-expanded={instHitsOpen}
                        aria-controls="map-inst-hits"
                        aria-autocomplete="list"
                      />
                      {instHitsOpen && (
                        <ul id="map-inst-hits" className="search-hits inst-hits" role="listbox">
                          {filteredInstitutions.length === 0 ? (
                            <li className="search-hint">אין מוסדות תואמים</li>
                          ) : (
                            filteredInstitutions.map((inst, idx) => (
                              <li key={inst.id} role="option" aria-selected={idx === activeInstHit}>
                                <button
                                  type="button"
                                  className={idx === activeInstHit ? "active" : undefined}
                                  onMouseEnter={() => setActiveInstHit(idx)}
                                  onClick={() => pickInstitution(inst)}
                                >
                                  {institutionOptionLabel(inst)}
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      )}
                    </label>
                    <button
                      type="button"
                      className="export"
                      disabled={!linkInstitutionId && !me?.institution_id}
                      onClick={() => void linkClusterToInstitution()}
                    >
                      קשר למוסד
                    </button>
                  </div>
                  {selectedInstitution && (
                    <p className="lede" style={{ margin: 0, fontSize: "0.85rem" }}>
                      נבחר: <ShowMore text={institutionOptionLabel(selectedInstitution)} />
                    </p>
                  )}
                </div>
              )}
              {(picked.linked || linkedOverride.has(picked.ashkol)) && (
                <p className="link-success-note">
                  מקושר למוסד
                  {linkedInstIdForPicked
                    ? ` «${institutions.find((i) => i.id === linkedInstIdForPicked)?.name ?? ""}»`
                    : ""}
                </p>
              )}
              {showCoordLink && (
                <div className="cluster-link-row assign-add">
                  <select
                    value={linkCoordId}
                    onChange={(e) => setLinkCoordId(e.target.value)}
                  >
                    <option value="">קשר רכז למוסד…</option>
                    {availableCoordinators.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="export"
                    disabled={!linkCoordId || !linkedInstIdForPicked}
                    onClick={() => void linkCoordinatorToInstitution()}
                  >
                    קשר רכז
                  </button>
                </div>
              )}
              {(() => {
                const pc = clusters.find((c) => c.ashkol === picked.ashkol);
                const stage = pc ? clusterProgressOf(pc).stage : picked.done ? "done" : "pending";
                return (
                  <p className={`cluster-stage-note is-${stage}`}>
                    {stage === "done" ? "האשכול בוצע ✓" : CLUSTER_STAGE_LABEL[stage]}
                  </p>
                );
              })()}
            </>
          ) : (
            null
          )}
        </aside>
        <aside className="street-card" aria-live="polite" data-tour="street-card">
          {selectedAshkol ? (
            <>
              <h2>
                רחובות באשכול <bdi dir="ltr">{selectedAshkol}</bdi>
              </h2>
              <ClusterStreetList
                streets={clusterStreets}
                loading={clusterStreetsLoading}
                color={clusterColors.get(selectedAshkol) ?? "#64748b"}
                pickedId={pickedStreet?.id}
                onToggleDone={(s, done) => void toggleStreetDone(s, done)}
                onPick={(s) => {
                  setPickedStreet(s);
                  void loadStreetAssign(s.id);
                  mapRef.current?.flyTo({ center: [s.lng, s.lat], zoom: 16 });
                }}
              />
              {pickedStreet && (
                <div className="assign-block" style={{ marginTop: "0.85rem" }}>
                  <span>
                    רכזים · <ShowMore text={pickedStreet.name_he} />
                  </span>
                  {assigned.length === 0 ? (
                    <p className="assign-empty">אין שיוך עדיין</p>
                  ) : (
                    <ul className="assign-list">
                      {assigned.map((a) => (
                        <li key={a.id}>
                          <ShowMore text={a.full_name} />
                          {allowed.some((x) => x.id === a.id) && (
                            <button
                              type="button"
                              className="reset"
                              onClick={() => void removeCoordinator(a.id)}
                            >
                              הסר
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {allowed.length > 0 && (
                    <div className="assign-add">
                      <select
                        value={assignId}
                        onChange={(e) => setAssignId(e.target.value)}
                      >
                        <option value="">הוספה לרכז</option>
                        {allowed.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.full_name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="export"
                        disabled={!assignId}
                        onClick={() => void assignCoordinator()}
                      >
                        הוסף
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : pickedStreet ? (
            <>
              <h2>
                <ShowMore text={pickedStreet.name_he} />
              </h2>
              {pickedStreet.ashkol ? (
                <div>
                  <span>אשכול</span>
                  <strong>
                    <bdi dir="ltr">{pickedStreet.ashkol}</bdi>
                  </strong>
                </div>
              ) : null}
              <div>
                <span>מצב</span>
                <strong>{pickedStreet.done ? "בוצע" : "פתוח"}</strong>
              </div>
              <div className="assign-block">
                <span>רכזים משויכים</span>
                {assigned.length === 0 ? (
                  <p className="assign-empty">אין שיוך עדיין</p>
                ) : (
                  <ul className="assign-list">
                    {assigned.map((a) => (
                      <li key={a.id}>
                        <ShowMore text={a.full_name} />
                        {allowed.some((x) => x.id === a.id) && (
                          <button
                            type="button"
                            className="reset"
                            onClick={() => void removeCoordinator(a.id)}
                          >
                            הסר
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {allowed.length > 0 && (
                  <div className="assign-add">
                    <select
                      value={assignId}
                      onChange={(e) => setAssignId(e.target.value)}
                    >
                      <option value="">הוספה לרכז</option>
                      {allowed.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.full_name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="export"
                      disabled={!assignId}
                      onClick={() => void assignCoordinator()}
                    >
                      הוסף
                    </button>
                  </div>
                )}
                {allowed.length === 0 && (
                  <p className="assign-empty">
                    אין רכז מותר לשיוך בעיר הזו (בדקו מוסד עם יישוב מקושר).
                  </p>
                )}
              </div>
            </>
          ) : (
            null
          )}
        </aside>
      </div>
      <div className={mapFull ? "street-map-stage is-full" : "street-map-stage"} data-tour="map" ref={stageRef}>
        <button
          type="button"
          className="map-full-btn"
          aria-pressed={mapFull}
          aria-label={mapFull ? "יציאה ממסך מלא" : "מסך מלא"}
          data-tip={mapFull ? "המפה חוזרת למקום" : "המפה על כל המסך"}
          onClick={() => setMapFull((full) => !full)}
        >
          {mapFull ? "חזור" : "מסך מלא"}
        </button>
        {picked ? (
          <aside className={menuOpen ? "route-map-menu is-open" : "route-map-menu"} data-tour="route-menu">
            <button
              type="button"
              className="route-menu-toggle"
              data-tour="route-toggle"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "סגור מסלול" : "פתח מסלול"}
              data-tip={menuOpen ? "סוגרים את תפריט המסלול" : "פותחים את תפריט המסלול"}
              onClick={() =>
                setMenuOpen((open) => {
                  if (open) setRouteMode("off");
                  return !open;
                })
              }
            >
              {menuOpen ? "סגור" : "מסלול"}
            </button>
            <div className="route-menu-body" hidden={!menuOpen}>
            <RoutePlanner
              ashkol={picked.ashkol}
              mode={routeMode}
              onMode={setRouteMode}
              onFeatures={setRouteFeatures}
              onActive={setActiveStage}
              onDrawDone={(draw) => {
                if (draw.done) void markStreetsAlong(draw.coordinates);
              }}
              onShowStage={showStage}
              onStages={(stages) => {
                setRouteStages(
                  stages.map((stage) => ({ stage_no: stage.stage_no, hasPoint: stage.hasPoint })),
                );
                const saved: Record<string, { reversed: boolean; from: number; to: number }> = {};
                for (const stage of stages) {
                  for (const street of stage.streets) {
                    saved[street.street_id] = {
                      reversed: street.reversed,
                      from: street.from_ratio,
                      to: street.to_ratio,
                    };
                  }
                }
                routeStreetRef.current = saved;
              }}
              bindRef={routeApiRef}
            />
            </div>
          </aside>
        ) : null}
        {sidePanel}
        {houseLegend.length > 0 && (
          <div className="eshkol-legend" dir="rtl">
            {legendTown && <p className="eshkol-legend-town">אשכולות ב{legendTown}</p>}
            {houseLegend.map((item) => (
              <button
                key={item.ashkol}
                type="button"
                aria-pressed={selectedAshkol === item.ashkol}
                onClick={() => selectEshkolRef.current(item.ashkol)}
              >
                <span
                  className="eshkol-swatch"
                  aria-hidden="true"
                  style={{
                    background:
                      !selectedAshkol || selectedAshkol === item.ashkol ? item.color : COLOR_MUTED,
                  }}
                />
                אשכול <bdi dir="ltr">{item.ashkol}</bdi>
              </button>
            ))}
            <p className="eshkol-legend-key">
              <span aria-hidden="true">◆</span> אשכול · <span aria-hidden="true">●</span> בית
              שמוקם · <span aria-hidden="true">━</span> רחוב
            </p>
            <p className="eshkol-legend-key">רק רחובות שזוהו במפה</p>
            <p className="eshkol-legend-key eshkol-stage-key">
              <span style={{ color: "#2563eb" }} aria-hidden="true">◆</span> ממתין ·{" "}
              <span style={{ color: "#f97316" }} aria-hidden="true">◆</span> בתהליך ·{" "}
              <span style={{ color: "#16a34a" }} aria-hidden="true">◆</span> בוצע
            </p>
          </div>
        )}
        {mapFailed ? (
          <div className="street-map-canvas map-fallback" role="status">
            <p>
              לא ניתן להציג את המפה בסביבה זו (WebGL לא זמין). אפשר להמשיך עם
              הטבלה, החיפוש, הפילטרים ובחירת אשכולות.
            </p>
          </div>
        ) : (
          <div ref={containerRef} className="street-map-canvas" />
        )}
      </div>
      <p className="map-credit">
        © OpenFreeMap © OpenMapTiles © OpenStreetMap contributors · Hebrew names from OSM
      </p>
    </div>
  );
}
