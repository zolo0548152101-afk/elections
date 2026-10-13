"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type VectorTileSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Turbopack rewrites the library chunk, so the relative worker URL 404s.
setWorkerUrl("/maplibre-gl-worker.mjs");
import type { ClusterView } from "./ClusterTable";
import { ShowMore } from "@/components/ShowMore";
import type { Feature } from "geojson";
import { matchesSearch } from "@/lib/text-search";
import { arrowMarks, directedGeometry, spanOf } from "@/lib/street-span";
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

function streetStatusPaint() {
  return {
    "line-color": [
      "case",
      ["==", ["get", "done"], 1],
      COLOR_DONE,
      ["==", ["get", "linked"], 1],
      COLOR_ASSIGNED,
      COLOR_UNASSIGNED,
    ] as unknown as string,
    "line-width": [
      "case",
      ["==", ["get", "done"], 1],
      5,
      ["==", ["get", "linked"], 1],
      3.5,
      2.5,
    ] as unknown as number,
    "line-opacity": [
      "case",
      ["==", ["get", "done"], 1],
      0.9,
      ["==", ["get", "linked"], 1],
      0.85,
      0.75,
    ] as unknown as number,
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
  const mapRef = useRef<MapLibreMap | null>(null);
  const openStreetPanelRef = useRef<(id: string, name: string) => void>(() => {});
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
  const [doneOverride, setDoneOverride] = useState<Record<string, boolean>>({});
  const [clusterStreets, setClusterStreets] = useState<SearchStreet[]>([]);
  const [clusterStreetsLoading, setClusterStreetsLoading] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const searchBoxRef = useRef<HTMLLabelElement | null>(null);
  const instComboRef = useRef<HTMLDivElement | null>(null);
  const [routeStages, setRouteStages] = useState<{ stage_no: number; hasPoint: boolean }[]>([]);
  const routeStreetRef = useRef<
    Record<string, { reversed: boolean; from: number; to: number }>
  >({});
  const [stageMenu, setStageMenu] = useState(false);
  const routeModeRef = useRef<RouteMode>("off");
  const routeApiRef = useRef<RouteApi | null>(null);
  const [routeMode, setRouteMode] = useState<RouteMode>("off");
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
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors (ODbL)",
          },
          streets: {
            type: "vector",
            tiles: [`${window.location.origin}/api/tiles/{z}/{x}/{y}`],
            minzoom: 10,
            maxzoom: 16,
          },
          clusters: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
          highlight: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
          route: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
          arrows: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          },
        },
        layers: [
          { id: "osm", type: "raster", source: "osm" },
          {
            id: "streets-line",
            type: "line",
            source: "streets",
            "source-layer": "streets",
            paint: streetStatusPaint(),
          },
          {
            id: "streets-label",
            type: "symbol",
            source: "streets",
            "source-layer": "streets",
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
          },
          {
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
              "circle-stroke-width": [
                "case",
                ["==", ["get", "selected"], 1],
                3,
                1,
              ],
              "circle-stroke-color": "#fff",
            },
          },
          {
            id: "highlight-line",
            type: "line",
            source: "highlight",
            paint: {
              "line-color": "#2563eb",
              "line-width": 7,
              "line-opacity": 0.95,
            },
          },
          {
            id: "route-casing",
            type: "line",
            source: "route",
            filter: ["==", ["geometry-type"], "LineString"],
            paint: {
              "line-color": "#ffffff",
              "line-width": 14,
              "line-opacity": 0.95,
            },
          },
          {
            id: "route-line",
            type: "line",
            source: "route",
            filter: ["==", ["geometry-type"], "LineString"],
            paint: {
              "line-color": ["get", "color"],
              "line-width": 9,
              "line-opacity": 1,
            },
          },
          {
            id: "route-arrows",
            type: "symbol",
            source: "arrows",
            layout: {
              "icon-image": "route-dir",
              "icon-size": 1.15,
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "icon-keep-upright": false,
              "icon-rotate": ["get", "bearing"],
              "icon-rotation-alignment": "map",
              "icon-pitch-alignment": "viewport",
            },
            paint: {
              "icon-color": "#111111",
              "icon-halo-color": "#ffffff",
              "icon-halo-width": 2,
            },
          },
          {
            id: "route-point",
            type: "circle",
            source: "route",
            filter: ["==", ["geometry-type"], "Point"],
            paint: {
              "circle-radius": 11,
              "circle-color": ["get", "color"],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            },
          },
          {
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
          },
        ],
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
    map.on("load", () => {
      if (!map.hasImage("route-dir")) {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, size, size);
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          // Tip points north. icon-rotate is the street bearing, 0 = north.
          ctx.moveTo(16, 2);
          ctx.lineTo(28, 28);
          ctx.lineTo(16, 21);
          ctx.lineTo(4, 28);
          ctx.closePath();
          ctx.fill();
          map.addImage("route-dir", ctx.getImageData(0, 0, size, size), { sdf: true });
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
      longFired = true;
      openStreetPanelRef.current(id, name || id);
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
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        if (!feature) return;
        openStagePopup({
          ...e,
          lngLat: origin,
          features: [feature],
        } as MapLayerMouseEvent);
      }, 550);
    }

    map.on("mousedown", "streets-line", armPress);
    map.on("touchstart", "streets-line", armPress);
    map.on("mousedown", "route-line", armPress);
    map.on("touchstart", "route-line", armPress);
    map.on("contextmenu", "streets-line", (e: MapLayerMouseEvent) => {
      e.preventDefault();
      clearPress();
      void openStagePopup(e);
    });
    let clickTimer: number | null = null;
    map.on("dblclick", "streets-line", (e: MapLayerMouseEvent) => {
      e.preventDefault();
      if (clickTimer != null) window.clearTimeout(clickTimer);
      clickTimer = null;
      clearPress();
      void openStagePopup(e);
    });
    map.on("dblclick", "route-line", (e: MapLayerMouseEvent) => {
      e.preventDefault();
      if (clickTimer != null) window.clearTimeout(clickTimer);
      clickTimer = null;
      clearPress();
      void openStagePopup(e);
    });
    const endPress = () => clearPress();
    map.on("mouseup", endPress);
    map.on("touchend", endPress);
    map.on("touchcancel", endPress);
    const movePress = (e: { point: { x: number; y: number } }) => {
      if (!pressAt || pressTimer == null) return;
      if (Math.hypot(e.point.x - pressAt.x, e.point.y - pressAt.y) > 12) clearPress();
    };
    map.on("mousemove", movePress);
    map.on("touchmove", movePress);

    map.on("click", "streets-line", async (e: MapLayerMouseEvent) => {
      if (longFired) {
        longFired = false;
        return;
      }
      const mode = routeModeRef.current;
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
      const id = String(f.properties?.id ?? "");
      const name = String(f.properties?.name_he ?? "");
      const ashkolRaw = f.properties?.ashkol;
      const ashkol =
        ashkolRaw != null && String(ashkolRaw).trim() !== ""
          ? String(ashkolRaw)
          : null;
      const done = Number(f.properties?.done ?? 0) === 1;
      if (!id) return;

      const street: SearchStreet = {
        id,
        name_he: name,
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
        ashkol,
        done: !done,
      };
      setPickedStreet({ ...street, done });
      void loadStreetAssign(id);

      setStatus(done ? `מסיר סימון: ${name}` : `מסמן בוצע: ${name}`);
      const res = await fetch(`/api/streets/${id}/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: !done }),
      });
      if (res.ok) {
        const src = map.getSource("streets") as VectorTileSource & {
          setTiles?: (tiles: string[]) => void;
        };
        src.setTiles?.([
          `${window.location.origin}/api/tiles/{z}/{x}/{y}?t=${Date.now()}`,
        ]);
        map.triggerRepaint();
        setPickedStreet({ ...street, done: !done });
        setClusterStreets((list) =>
          list.map((s) => (s.id === id ? { ...s, done: !done } : s)),
        );
        setStatus(done ? `הוסר סימון: ${name}` : `סומן בוצע: ${name}`);
      } else {
        setStatus("שגיאה בסימון");
      }
    }

    map.on("click", (e) => {
      if (startLong) {
        startLong = false;
        return;
      }
      if (routeClickHandled) {
        routeClickHandled = false;
        return;
      }
      if (routeModeRef.current === "point") {
        routeApiRef.current?.addPoint(e.lngLat.lat, e.lngLat.lng);
      }
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

    function occupied(point: { x: number; y: number }) {
      if (!map.isStyleLoaded()) return false;
      const layers = ["streets-line", "route-line", "clusters-circle", "route-point"].filter(
        (id) => map.getLayer(id),
      );
      if (layers.length === 0) return false;
      return map.queryRenderedFeatures([point.x, point.y], { layers }).length > 0;
    }
    let startTimer: number | null = null;
    let startAt: { x: number; y: number } | null = null;
    function clearStart() {
      if (startTimer != null) window.clearTimeout(startTimer);
      startTimer = null;
      startAt = null;
    }
    function armStart(e: { point: { x: number; y: number }; lngLat: { lat: number; lng: number } }) {
      if (occupied(e.point)) return;
      clearStart();
      startLong = false;
      startAt = { x: e.point.x, y: e.point.y };
      const { lat, lng } = e.lngLat;
      startTimer = window.setTimeout(() => {
        startTimer = null;
        startLong = true;
        openStartRef.current(lat, lng);
      }, 550);
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
      if (occupied(e.point)) return;
      e.preventDefault();
      e.originalEvent.preventDefault();
      window.setTimeout(() => map.stop(), 0);
      openStartRef.current(e.lngLat.lat, e.lngLat.lng);
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

  /** Status colors; selection only thickens the line. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer("streets-line")) return;
    const ashkol = selectedAshkol || "";
    const streetId = pickedStreet?.id || "";
    const apply = () => {
      if (!map.getLayer("streets-line")) return;
      map.setPaintProperty("streets-line", "line-color", [
        "case",
        ["==", ["get", "done"], 1],
        COLOR_DONE,
        ["==", ["get", "linked"], 1],
        COLOR_ASSIGNED,
        COLOR_UNASSIGNED,
      ]);
      map.setPaintProperty("streets-line", "line-width", [
        "case",
        ["all", ["!=", ["literal", streetId], ""], ["==", ["get", "id"], streetId]],
        7,
        ["all", ["!=", ["literal", ashkol], ""], ["==", ["get", "ashkol"], ashkol]],
        6,
        ["==", ["get", "done"], 1],
        5,
        ["==", ["get", "linked"], 1],
        3.5,
        2.5,
      ]);
      map.setPaintProperty("streets-line", "line-opacity", [
        "case",
        ["all", ["!=", ["literal", streetId], ""], ["==", ["get", "id"], streetId]],
        1,
        ["all", ["!=", ["literal", ashkol], ""], ["==", ["get", "ashkol"], ashkol]],
        0.95,
        ["==", ["get", "done"], 1],
        0.9,
        ["==", ["get", "linked"], 1],
        0.85,
        0.75,
      ]);
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [selectedAshkol, pickedStreet?.id]);

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

  function refreshStreetTiles() {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("streets") as VectorTileSource & {
      setTiles?: (tiles: string[]) => void;
    };
    src.setTiles?.([
      `${window.location.origin}/api/tiles/{z}/{x}/{y}?t=${Date.now()}`,
    ]);
    map.triggerRepaint();
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
    refreshStreetTiles();
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
  }, [routeMode]);

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
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let alive = true;

    const lines = () => {
      const out: { key: string; coords: number[][]; step: number }[] = [];
      routeFeatures.forEach((feature, index) => {
        if (feature.geometry.type !== "LineString") return;
        const span = Math.max(0.05, Number(feature.properties?.span ?? 1));
        out.push({
          key: `route-${index}`,
          coords: feature.geometry.coordinates as number[][],
          step: (0.004 * 0.3) / span,
        });
      });
      if (panel?.kind === "street") {
        const ratios = panel.frozen ?? keptRatios(panel.keep, panel.anchor);
        const sliced = directedGeometry(
          spanOf(panel.geometry, ratios.from, ratios.to),
          panel.reversed,
        );
        if (sliced?.type === "LineString") {
          const span = Math.max(0.05, ratios.to - ratios.from);
          out.push({
            key: `preview-${panel.id}`,
            coords: sliced.coordinates,
            step: (0.004 * 0.3) / span,
          });
        }
      }
      return out;
    };

    const phases = new Map<string, number>();
    const draw = () => {
      const src = map.getSource("arrows") as GeoJSONSource | undefined;
      if (!src) return;
      const features = lines().flatMap((line) => {
        const current = phases.get(line.key) ?? 0;
        return arrowMarks(line.coords, current).map((mark) => ({
          type: "Feature" as const,
          properties: { bearing: mark.bearing, kind: "arrow" },
          geometry: { type: "Point" as const, coordinates: [mark.lng, mark.lat] },
        }));
      });
      src.setData({ type: "FeatureCollection", features });
    };

    const tick = () => {
      if (!alive) return;
      if (!media.matches) {
        for (const line of lines()) {
          const current = phases.get(line.key) ?? 0;
          phases.set(line.key, (current + line.step) % 1);
        }
      }
      draw();
      frame = window.requestAnimationFrame(tick);
    };

    const start = () => {
      if (!alive) return;
      window.cancelAnimationFrame(frame);
      if (media.matches) {
        draw();
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };

    if (map.isStyleLoaded()) start();
    else map.once("load", start);
    const onMotion = () => start();
    media.addEventListener("change", onMotion);
    return () => {
      alive = false;
      window.cancelAnimationFrame(frame);
      media.removeEventListener("change", onMotion);
      map.off("load", start);
    };
  }, [routeFeatures, panel]);

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
    refreshStreetTiles();
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
    refreshStreetTiles();
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

  openStartRef.current = (lat, lng) => {
    setPanel({ kind: "start", lat, lng, mode: "choose" });
  };
  openStreetPanelRef.current = (id, name) => {
    setStageMenu(false);
    const saved = routeStreetRef.current[id];
    const portion = portionFromSaved(saved?.from ?? 0, saved?.to ?? 1);
    setPanel({
      kind: "street",
      id,
      name,
      keep: portion.keep,
      anchor: portion.anchor,
      frozen: portion.frozen,
      reversed: Boolean(saved?.reversed),
      geometry: null,
    });
    void fetch(`/api/streets/${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setPanel((prev) =>
          prev?.kind === "street" && prev.id === id
            ? { ...prev, geometry: (data.geometry ?? null) as RouteGeometry | null }
            : prev,
        );
      })
      .catch(() => {});
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
    setStatus("נקודת איסוף נשמרה");
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
      ) : panel.kind === "start" ? (
        <>
          {panel.mode === "collect" ? (
            <>
              <strong>נקודת איסוף</strong>
              <div className="route-inline">
                {routeStages
                  .filter((stage) => stage.stage_no > 1 && stage.hasPoint)
                  .map((stage, index) => (
                    <button
                      key={stage.stage_no}
                      type="button"
                      className="route-icon-btn"
                      aria-label={`איסוף ${index + 1}`}
                      onClick={() => saveCollectionPoint(stage.stage_no)}
                    >
                      {index + 1}
                    </button>
                  ))}
                <button
                  type="button"
                  className="route-icon-btn"
                  aria-label="נקודת איסוף חדשה"
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
                aria-label="נקודת איסוף"
                onClick={() => {
                  const existing = routeStages.filter((stage) => stage.stage_no > 1 && stage.hasPoint);
                  if (existing.length === 0) {
                    saveCollectionPoint("new");
                    return;
                  }
                  setPanel((prev) => (prev?.kind === "start" ? { ...prev, mode: "collect" } : prev));
                }}
              >
                איסוף
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
            {routeStages.length > 0 ? (
              <button
                type="button"
                className="route-icon-btn route-stage-dot"
                style={{ background: stageColor(routeStages.length === 1 ? routeStages[0]!.stage_no : 1) }}
                aria-label={routeStages.length > 1 ? "בחירת שלב" : `שלב ${routeStages[0]!.stage_no}`}
                aria-expanded={routeStages.length > 1 ? stageMenu : undefined}
                onClick={() => {
                  if (routeStages.length > 1) {
                    setStageMenu((open) => !open);
                    return;
                  }
                  addPanelStreet(routeStages[0]!.stage_no);
                }}
              />
            ) : null}
            {stageMenu && routeStages.length > 1 ? (
              <div className="route-stage-menu" role="menu">
                {routeStages.map((stage) => (
                  <button
                    key={stage.stage_no}
                    type="button"
                    role="menuitem"
                    className="route-icon-btn route-stage-dot"
                    style={{ background: stageColor(stage.stage_no) }}
                    aria-label={`שלב ${stage.stage_no}`}
                    onClick={() => {
                      setStageMenu(false);
                      addPanelStreet(stage.stage_no);
                    }}
                  />
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="route-icon-btn"
              aria-label="שלב חדש"
              onClick={() => addPanelStreet("new")}
            >
              +
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
              <RoutePlanner
                ashkol={picked.ashkol}
                mode={routeMode}
                onMode={setRouteMode}
                onFeatures={setRouteFeatures}
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
        © OpenStreetMap contributors · data available under ODbL · Hebrew names from OSM
      </p>
    </div>
  );
}
