"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
import type { Feature } from "geojson";
import { matchesSearch } from "@/lib/text-search";
import { arrowMarksEvery, closestInsert, directedGeometry, spanOf } from "@/lib/street-span";
import { streetsTilePath } from "@/lib/tiles-version";
import type { RouteGeometry } from "@/lib/cluster-route-types";
import { RoutePlanner, stageColor, type RouteMode, type RouteApi } from "@/components/RoutePlanner";

type SearchStreet = {
  id: string;
  name_he: string;
  lat: number;
  lng: number;
  ashkol: string | null;
  done: boolean;
  near_settlement?: string | null;
};

type SearchCity = {
  name_he: string;
  lat: number;
  lng: number;
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

/** Street status. Cluster dots from the filter use a separate gold. */
const COLOR_UNASSIGNED = "#2563eb";
const COLOR_ASSIGNED = "#c45c26";
const COLOR_DONE = "#16a34a";
const COLOR_FILTERED = "#f5b942";
const COLOR_SEARCH = "#22d3ee";
const COLOR_SELECTED = "#dc2626";

const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/bright";

type MapState = {
  doneStreetIds: string[];
  visibleAshkols: string[] | null;
  scopeActive: boolean;
  linkedAshkols: string[];
};

type Expr = unknown[];

function doneFlag(): Expr {
  return ["boolean", ["feature-state", "done"], false];
}

function linkedFlag(linkedAshkols: string[]): Expr {
  if (linkedAshkols.length === 0) return ["literal", 0];
  return ["match", ["get", "ashkol"], linkedAshkols, 1, 0];
}

function streetLinePaint(linkedAshkols: string[], selectedAshkol = "", streetId = "") {
  const done = doneFlag();
  const linked = linkedFlag(linkedAshkols);
  const selectedStreet: Expr = streetId ? ["==", ["get", "id"], streetId] : ["literal", false];
  const selectedCluster: Expr = selectedAshkol
    ? ["==", ["get", "ashkol"], selectedAshkol]
    : ["literal", false];
  return {
    "line-color": ["case", done, COLOR_DONE, ["==", linked, 1], COLOR_ASSIGNED, COLOR_UNASSIGNED],
    "line-width": ["case", selectedStreet, 7, selectedCluster, 6, done, 5, ["==", linked, 1], 3.5, 2.5],
    "line-opacity": [
      "case",
      selectedStreet,
      1,
      selectedCluster,
      0.95,
      done,
      0.9,
      ["==", linked, 1],
      0.85,
      0.75,
    ],
  };
}

function scopeFilter(active: boolean, ashkols: string[] | null): Expr | null {
  if (!active) return null;
  if (!ashkols || ashkols.length === 0) return ["literal", false];
  return ["match", ["get", "ashkol"], ashkols, true, false];
}

function streetFeature(id: string) {
  return { source: "streets", sourceLayer: "streets", id };
}

function applyStreetState(map: MapLibreMap, state: MapState, doneIds: Set<string>) {
  if (!map.getLayer("streets-line")) return;
  for (const id of doneIds) map.removeFeatureState(streetFeature(id));
  doneIds.clear();
  for (const id of state.doneStreetIds) {
    map.setFeatureState(streetFeature(id), { done: true });
    doneIds.add(id);
  }
  const filter = scopeFilter(state.scopeActive, state.visibleAshkols);
  for (const layer of ["streets-line", "streets-label"]) {
    if (!map.getLayer(layer)) continue;
    map.setFilter(layer, filter as never);
  }
}

function addMapOverlays(map: MapLibreMap) {
  if (map.getSource("streets")) return;
  map.addSource("streets", {
    type: "vector",
    tiles: [`${window.location.origin}${streetsTilePath()}`],
    minzoom: 10,
    maxzoom: 16,
    promoteId: { streets: "id" },
  });
  map.addSource("clusters", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource("highlight", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource("route", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource("arrows", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource("pin", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  const hidden: Expr = ["literal", false];
  map.addLayer({
    id: "streets-line",
    type: "line",
    source: "streets",
    "source-layer": "streets",
    filter: hidden as never,
    paint: streetLinePaint([]) as never,
  });
  map.addLayer({
    id: "streets-label",
    type: "symbol",
    source: "streets",
    "source-layer": "streets",
    filter: hidden as never,
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "name_he"],
      "text-size": 12,
      "text-font": ["Noto Sans Regular"],
    },
    paint: {
      "text-color": "#111827",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.2,
    },
    minzoom: 13,
  });
  map.addLayer({
    id: "clusters-circle",
    type: "circle",
    source: "clusters",
    paint: {
      "circle-radius": 8,
      "circle-color": [
        "case",
        ["==", ["get", "selected"], 1],
        COLOR_SELECTED,
        ["==", ["get", "done"], 1],
        COLOR_DONE,
        ["==", ["get", "searched"], 1],
        COLOR_SEARCH,
        COLOR_FILTERED,
      ],
      "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 3, 1],
      "circle-stroke-color": "#fff",
    },
  });
  map.addLayer({
    id: "highlight-line",
    type: "line",
    source: "highlight",
    paint: { "line-color": "#2563eb", "line-width": 7, "line-opacity": 0.95 },
  });
  map.addLayer({
    id: "route-casing",
    type: "line",
    source: "route",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.95 },
  });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": ["get", "color"], "line-width": 4.5, "line-opacity": 1 },
  });
  map.addLayer({
    id: "route-arrows",
    type: "symbol",
    source: "route",
    filter: ["==", ["get", "kind"], "arrow"],
    layout: {
      "icon-image": "route-dir",
      "icon-size": 0.8,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-keep-upright": false,
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "viewport",
    },
  });
  map.addLayer({
    id: "proposed-pin",
    type: "symbol",
    source: "pin",
    layout: {
      "icon-image": "place-pin",
      "icon-size": 0.25,
      "icon-anchor": "bottom",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
  map.addLayer({
    id: "route-point",
    type: "circle",
    source: "route",
    filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "kind"], "point"]],
    paint: {
      "circle-radius": 11,
      "circle-color": ["get", "color"],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
  map.addLayer({
    id: "route-point-label",
    type: "symbol",
    source: "route",
    filter: ["==", ["get", "kind"], "point"],
    layout: {
      "text-field": ["coalesce", ["get", "label"], ["to-string", ["get", "stage"]]],
      "text-size": 12,
      "text-font": ["Noto Sans Regular"],
      "text-offset": [0, -1.3],
    },
    paint: {
      "text-color": "#102033",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.2,
    },
  });
  map.addLayer({
    id: "draw-handle",
    type: "circle",
    source: "route",
    filter: ["==", ["get", "kind"], "handle"],
    paint: {
      "circle-radius": 7,
      "circle-color": "#ffffff",
      "circle-stroke-width": 3,
      "circle-stroke-color": ["get", "color"],
    },
  });
  map.addLayer({
    id: "draw-number",
    type: "symbol",
    source: "route",
    filter: ["==", ["get", "kind"], "stretch-no"],
    layout: {
      "text-field": ["get", "label"],
      "text-size": ["case", ["==", ["get", "selected"], 1], 22, 16],
      "text-font": ["Noto Sans Regular"],
      "text-offset": [0, -1.5],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#111111",
      "text-halo-color": "#ffffff",
      "text-halo-width": 2,
    },
  });
  map.addLayer({
    id: "draw-end-label",
    type: "symbol",
    source: "route",
    filter: ["in", ["get", "label"], ["literal", ["A", "B"]]],
    layout: {
      "text-field": ["get", "label"],
      "text-size": 13,
      "text-font": ["Noto Sans Regular"],
      "text-anchor": "center",
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#111111",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.2,
    },
  });
  map.addLayer({
    id: "draw-meter",
    type: "symbol",
    source: "route",
    filter: ["==", ["get", "kind"], "meter"],
    layout: {
      "text-field": ["get", "label"],
      "text-size": 13,
      "text-font": ["Noto Sans Regular"],
      "text-offset": [0, 1.45],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#102033",
      "text-halo-color": "#ffffff",
      "text-halo-width": 2,
    },
  });
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
  const zoomClusterRef = useRef<(lng: number, lat: number, ashkol: string) => void>(() => {});
  const [q, setQ] = useState("");
  const [cityHits, setCityHits] = useState<SearchCity[]>([]);
  const [streetHits, setStreetHits] = useState<SearchStreet[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [parsedCity, setParsedCity] = useState<string | null>(null);
  const [activeHit, setActiveHit] = useState(0);
  const [status, setStatus] = useState("טוען מפה…");
  const [selectedAshkol, setSelectedAshkol] = useState<string>("");
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
  const [doneOverride, setDoneOverride] = useState<Record<string, boolean>>({});
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
      addMapOverlays(map);
      if (mapStateRef.current) applyStreetState(map, mapStateRef.current, doneIdsRef.current);
      if (!overlayBound) {
        overlayBound = true;
        bindOverlayInteractions();
      }
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
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, size, size);
          ctx.fillStyle = "#111111";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 3;
          ctx.beginPath();
          // Tip points north. icon-rotate is the travel bearing, 0 = north.
          ctx.moveTo(16, 3);
          ctx.lineTo(28, 28);
          ctx.lineTo(16, 21);
          ctx.lineTo(4, 28);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          map.addImage("route-dir", ctx.getImageData(0, 0, size, size));
        }
      }
      setStatus("לחצו על רחוב לסימון");
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
      if (!map.isStyleLoaded()) return null;
      const layers = ["route-line", "streets-line"].filter((id) => map.getLayer(id));
      if (layers.length === 0) return null;
      const pad = 28;
      const hits = map.queryRenderedFeatures(
        [
          [point.x - pad, point.y - pad],
          [point.x + pad, point.y + pad],
        ],
        { layers },
      );
      const feature = hits.find((hit) => String(hit.properties?.id ?? "") !== "");
      if (!feature) return null;
      const id = String(feature.properties?.id ?? feature.id ?? "");
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
    map.on("mousedown", "streets-line", armPress);
    let stretchDrag: { stage: number; draw: number; vertex: number; moved: boolean } | null = null;
    let stretchMoved = false;

    function beginHandleDrag(e: {
      point: { x: number; y: number };
      preventDefault: () => void;
      features?: MapLayerMouseEvent["features"];
    }) {
      if (routeModeRef.current !== "stretch") return;
      e.preventDefault();
      const feature = e.features?.[0];
      if (!feature) return;
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
      if (
        routeModeRef.current === "stretch" &&
        kind === "draw" &&
        feature?.geometry.type === "LineString"
      ) {
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
    map.on("contextmenu", "streets-line", (e: MapLayerMouseEvent) => {
      e.preventDefault();
      clearPress();
      void openStagePopup(e);
    });
    map.on("dblclick", "streets-line", (e: MapLayerMouseEvent) => {
      if (finishByDoubleClick(e)) return;
      e.preventDefault();
      if (clickTimer != null) window.clearTimeout(clickTimer);
      clickTimer = null;
      clearPress();
      void openStagePopup(e);
    });
    map.on("click", "route-line", (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (String(feature?.properties?.kind) !== "draw") return;
      routeClickHandled = true;
      setMenuOpen(true);
      routeApiRef.current?.selectStretch(
        Number(feature?.properties?.stage),
        Number(feature?.properties?.draw),
      );
    });
    map.on("dblclick", "route-line", (e: MapLayerMouseEvent) => {
      if (finishByDoubleClick(e)) return;
      e.preventDefault();
      if (clickTimer != null) window.clearTimeout(clickTimer);
      clickTimer = null;
      clearPress();
      void openStagePopup(e);
    });
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
        clearPress();
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
      if (stretchDrag && pressAt && Math.hypot(e.point.x - pressAt.x, e.point.y - pressAt.y) > 6) {
        clearPress();
        stretchDrag = { ...stretchDrag, moved: true };
        routeApiRef.current?.moveStretchVertex(
          stretchDrag.stage,
          stretchDrag.draw,
          stretchDrag.vertex,
          e.lngLat.lng,
          e.lngLat.lat,
          false,
        );
      } else if (pressAt && pressTimer != null && Math.hypot(e.point.x - pressAt.x, e.point.y - pressAt.y) > 40) {
        clearPress();
      }
    };
    map.on("mousemove", movePress);
    map.on("touchmove", movePress);

    map.on("click", "streets-line", async (e: MapLayerMouseEvent) => {
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
          return kind === "draw" || kind === "handle" || kind === "point" || layer === "clusters-circle";
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
      if (map.queryRenderedFeatures(e.point, { layers: ["streets-line", "route-line", "clusters-circle"] }).length > 0) {
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

    let clusterClickTimer: number | null = null;
    let clusterLong = false;
    let clusterTimer: number | null = null;
    function zoomCluster(e: MapLayerMouseEvent) {
      const raw = e.features?.[0]?.properties;
      if (!raw) return;
      const cluster = clusterFromProps(raw as Record<string, unknown>);
      zoomClusterRef.current(e.lngLat.lng, e.lngLat.lat, cluster.ashkol);
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
        zoomCluster(e as MapLayerMouseEvent);
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
      if (clusterClickTimer != null) window.clearTimeout(clusterClickTimer);
      clusterClickTimer = null;
      if (clusterTimer != null) window.clearTimeout(clusterTimer);
      clusterTimer = null;
      zoomCluster(e);
    });
    map.on("click", "clusters-circle", (e: MapLayerMouseEvent) => {
      if (routeModeRef.current !== "off") return;
      if (clusterLong) {
        clusterLong = false;
        return;
      }
      if (clusterClickTimer != null) window.clearTimeout(clusterClickTimer);
      clusterClickTimer = window.setTimeout(() => {
        clusterClickTimer = null;
        const raw = e.features?.[0]?.properties;
        if (!raw) return;
        openClusterPanelRef.current(clusterFromProps(raw as Record<string, unknown>));
      }, 280);
    });

    map.on("mouseenter", "streets-line", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "streets-line", () => {
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
    return () => {
      try {
        map.remove();
      } catch {
        /* already removed after WebGL failure */
      }
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const features = clusters
      .filter((c) => c.map_lat != null && c.map_lng != null)
      .map((c) => {
        const linked = Boolean(c.linked) || linkedOverride.has(c.ashkol);
        const done =
          doneOverride[c.ashkol] !== undefined
            ? doneOverride[c.ashkol]
            : Boolean(c.done);
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
            selected: selectedAshkol === c.ashkol ? 1 : 0,
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
  }, [clusters, selectedAshkol, linkedOverride, doneOverride, searchPlace]);

  useEffect(() => {
    if (!picked) return;
    if (clusters.some((c) => c.ashkol === picked.ashkol)) return;
    setPicked(null);
    setSelectedAshkol("");
  }, [clusters, picked]);

  /** Status colors; selection only thickens the line. Done comes from feature-state. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const linked = new Set<string>([
      ...(mapState?.linkedAshkols ?? []),
      ...linkedOverride,
    ]);
    const paint = streetLinePaint([...linked], selectedAshkol || "", pickedStreet?.id || "");
    const apply = () => {
      if (!map.getLayer("streets-line")) return;
      map.setPaintProperty("streets-line", "line-color", paint["line-color"] as never);
      map.setPaintProperty("streets-line", "line-width", paint["line-width"] as never);
      map.setPaintProperty("streets-line", "line-opacity", paint["line-opacity"] as never);
    };
    apply();
    if (!map.getLayer("streets-line")) map.once("idle", apply);
  }, [selectedAshkol, pickedStreet?.id, mapState, linkedOverride]);

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
      setStatus(nextDone ? `סומן בוצע: ${street.name_he}` : `הוסר סימון: ${street.name_he}`);
    };
  });

  async function markStreetsAlong(coordinates: number[][]) {
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !map.getLayer("streets-line")) return;
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
        { layers: ["streets-line"] },
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
    if (pickedStreet?.id === street.id) {
      setPickedStreet({ ...pickedStreet, done });
    }
    setStreetDoneRef.current(street.id, done);
    setStatus(done ? `סומן בוצע: ${street.name_he}` : `הוסר סימון: ${street.name_he}`);
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map || focus) return;
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
  }, [clusters, focus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const apply = () => {
      map.flyTo({ center: [focus.lng, focus.lat], zoom: 13 });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [focus]);

  /** Table / external ashkol pick — select cluster, highlight streets, fly to point. */
  useEffect(() => {
    if (!focusAshkol) return;
    const cluster = clusters.find((c) => c.ashkol === focusAshkol) ?? null;
    setSelectedAshkol(focusAshkol);
    setPicked(cluster);
    const map = mapRef.current;
    if (!map || !cluster || cluster.map_lng == null || cluster.map_lat == null) {
      return;
    }
    const apply = () => {
      map.flyTo({
        center: [cluster.map_lng!, cluster.map_lat!],
        zoom: 14,
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [focusAshkol, focusAshkolToken, clusters]);

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
    const next = clusters[0]!;
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
    } else {
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
  };
  zoomClusterRef.current = (lng, lat, ashkol) => {
    const cluster = clusters.find((c) => c.ashkol === ashkol);
    if (cluster) {
      setSelectedAshkol(cluster.ashkol);
      setPicked(cluster);
    }
    setPanel(null);
    const map = mapRef.current;
    if (!map) return;
    window.setTimeout(() => {
      map.stop();
      map.flyTo({ center: [lng, lat], zoom: 16 });
    }, 0);
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

  const selectedDone = selectedAshkol
    ? Boolean(
        doneOverride[selectedAshkol] ??
          clusters.find((c) => c.ashkol === selectedAshkol)?.done,
      )
    : false;

  const sidePanel = panel ? (
    <aside className="map-side-panel" aria-live="polite">
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
    <div className="street-map-wrap">
      <div className="street-map-toolbar">
        {me != null && me.role !== "coordinator" && (
        <label className="search-box" ref={searchBoxRef}>
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
            aria-autocomplete="list"
          />
          {showHits && (
            <ul className="search-hits" role="listbox">
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
        <label>
          אשכול
          <select
            value={selectedAshkol}
            onChange={(e) => {
              const ashkol = e.target.value;
              setSelectedAshkol(ashkol);
              const cluster = clusters.find((c) => c.ashkol === ashkol) ?? null;
              setPicked(cluster);
              setPanel(cluster ? { kind: "cluster", cluster } : null);
              if (cluster?.map_lng != null && cluster.map_lat != null) {
                mapRef.current?.flyTo({
                  center: [cluster.map_lng, cluster.map_lat],
                  zoom: 14,
                });
              }
            }}
          >
            {me?.role === "coordinator" ? null : (
              <option value="">בחרו אשכול</option>
            )}
            {clusters.map((c) => (
              <option key={c.ashkol} value={c.ashkol}>
                {c.settlement_name} · {c.ashkol}
                {(doneOverride[c.ashkol] ?? c.done) ? " · בוצע" : ""}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="export"
          disabled={!selectedAshkol || selectedDone}
          onClick={() => markClusterStreets(true)}
        >
          סמן אשכול כבוצע
        </button>
        <button
          type="button"
          className="reset"
          disabled={!selectedAshkol || !selectedDone}
          onClick={() => markClusterStreets(false)}
        >
          נקה אשכול
        </button>
        <button type="button" className="reset" onClick={showAllClusters}>
          הצג הכל
        </button>
        <p
          className={`map-status${status.includes("סומן כבוצע") ? " link-success-note" : ""}`}
          role="status"
        >
          {status}
        </p>
      </div>
      <div className="map-side-cards">
        <aside className="cluster-card" aria-live="polite">
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
                        aria-autocomplete="list"
                      />
                      {instHitsOpen && (
                        <ul className="search-hits inst-hits" role="listbox">
                          {filteredInstitutions.length === 0 ? (
                            <li className="search-hint">אין מוסדות תואמים</li>
                          ) : (
                            filteredInstitutions.map((inst, idx) => (
                              <li key={inst.id} role="option">
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
              {(doneOverride[picked.ashkol] ?? picked.done) && (
                <p className="link-success-note">אשכול בוצע</p>
              )}
            </>
          ) : (
            <p>לחצו על נקודת אשכול כדי לראות כאן את בז״ב, המצביעים, ההצבעה והימין, לצד הרחובות.</p>
          )}
        </aside>
        <aside className="street-card" aria-live="polite">
          {selectedAshkol ? (
            <>
              <h2>
                רחובות באשכול <bdi dir="ltr">{selectedAshkol}</bdi>
              </h2>
              {clusterStreetsLoading ? (
                <p className="assign-empty">טוען רחובות…</p>
              ) : clusterStreets.length === 0 ? (
                <p className="assign-empty">
                  אין רחובות מקושרים לאשכול (ממתינים לקובץ קישור). כשיופיעו — ניתן
                  לסמן בוצע ליד כל שם.
                </p>
              ) : (
                <ul className="cluster-street-list">
                  {clusterStreets.map((s) => (
                    <li key={s.id}>
                      <label className="cluster-street-item">
                        <input
                          type="checkbox"
                          checked={s.done}
                          onChange={(e) =>
                            void toggleStreetDone(s, e.target.checked)
                          }
                        />
                        <button
                          type="button"
                          className="cluster-street-name"
                          onClick={() => {
                            setPickedStreet(s);
                            void loadStreetAssign(s.id);
                            mapRef.current?.flyTo({
                              center: [s.lng, s.lat],
                              zoom: 16,
                            });
                          }}
                        >
                          {s.name_he}
                        </button>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
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
            <p>
              בחרו אשכול כדי לראות את רחובותיו (כשיהיו מקושרים) ולסמן בוצע, או לחצו
              על רחוב במפה.
            </p>
          )}
        </aside>
      </div>
      <div className="street-map-stage">
        {picked ? (
          <aside className={menuOpen ? "route-map-menu is-open" : "route-map-menu"}>
            <button
              type="button"
              className="route-menu-toggle"
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
