/**
 * MapLibre layers, paint expressions and small map helpers for StreetMap.
 * Pure functions of the map instance — no React state lives here.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import { streetsTilePath } from "@/lib/tiles-version";

/** Street status. Cluster dots from the filter use a separate gold. */
export const COLOR_ASSIGNED = "#c45c26";
export const COLOR_DONE = "#16a34a";
export const COLOR_FILTERED = "#f5b942";
export const COLOR_SEARCH = "#22d3ee";

export const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/bright";

export type MapState = {
  doneStreetIds: string[];
  visibleAshkols: string[] | null;
  scopeActive: boolean;
  linkedAshkols: string[];
};

export type Expr = unknown[];

export function doneFlag(): Expr {
  return ["boolean", ["feature-state", "done"], false];
}

export function linkedFlag(linkedAshkols: string[]): Expr {
  if (linkedAshkols.length === 0) return ["literal", 0];
  return ["match", ["get", "ashkol"], linkedAshkols, 1, 0];
}

/** Each street is drawn in its cluster's colour (the same colour as that cluster's house dots). */
export function clusterColorExpr(colors: Map<string, string>): Expr {
  if (colors.size === 0) return ["literal", COLOR_ASSIGNED];
  const pairs: string[] = [];
  for (const [ashkol, color] of colors) pairs.push(ashkol, color);
  return ["match", ["get", "ashkol"], ...pairs, COLOR_ASSIGNED];
}

export function streetLinePaint(
  linkedAshkols: string[],
  selectedAshkol = "",
  streetId = "",
  colors: Map<string, string> = new Map(),
) {
  const done = doneFlag();
  const linked = linkedFlag(linkedAshkols);
  const selectedStreet: Expr = streetId ? ["==", ["get", "id"], streetId] : ["literal", false];
  const selectedCluster: Expr = selectedAshkol
    ? ["==", ["get", "ashkol"], selectedAshkol]
    : ["literal", false];
  return {
    "line-color": ["case", done, COLOR_DONE, clusterColorExpr(colors)],
    "line-width": ["case", selectedStreet, 8, selectedCluster, 6.5, done, 5, ["==", linked, 1], 4.5, 4],
    "line-opacity": [
      "case",
      selectedStreet,
      1,
      selectedCluster,
      1,
      selectedAshkol ? 0.35 : 0.9,
    ],
  };
}

/** Show only streets that belong to a cluster on the list (the list already respects the user's scope and filters). */
export function clusterStreetFilter(ashkols: string[]): Expr {
  if (ashkols.length === 0) return ["literal", false];
  return ["match", ["get", "ashkol"], ashkols, true, false];
}

export function streetFeature(id: string) {
  return { source: "streets", sourceLayer: "streets", id };
}

export function applyStreetState(map: MapLibreMap, state: MapState, doneIds: Set<string>) {
  if (!map.getLayer("streets-line")) return;
  for (const id of doneIds) map.removeFeatureState(streetFeature(id));
  doneIds.clear();
  for (const id of state.doneStreetIds) {
    map.setFeatureState(streetFeature(id), { done: true });
    doneIds.add(id);
  }
}

export function applyStreetFilter(map: MapLibreMap, ashkols: string[]) {
  const filter = clusterStreetFilter(ashkols);
  for (const layer of ["streets-line", "streets-label"]) {
    if (!map.getLayer(layer)) continue;
    map.setFilter(layer, filter as never);
  }
}

export const ROUTE_LINE_PX = 4.5 * 0.9;
export const ROUTE_CASING_PX = 7 * 0.9;
export const ROUTE_ARROW_PX = 24;

export function addMapOverlays(map: MapLibreMap) {
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
  map.addSource("eshkol-houses", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  const hidden: Expr = ["literal", false];
  // Colored street lines go under the basemap's labels (place names stay readable);
  // our own street names, houses and clusters are added above everything.
  const firstBasemapLabel = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
  map.addLayer(
    {
      id: "streets-line",
      type: "line",
      source: "streets",
      "source-layer": "streets",
      filter: hidden as never,
      layout: { visibility: "visible", "line-cap": "round", "line-join": "round" },
      paint: streetLinePaint([]) as never,
    },
    firstBasemapLabel,
  );
  map.addLayer({
    id: "streets-label",
    type: "symbol",
    source: "streets",
    "source-layer": "streets",
    filter: hidden as never,
    layout: {
      visibility: "visible",
      "symbol-placement": "line",
      "text-field": ["get", "name_he"],
      "text-size": 12,
      "text-font": ["Noto Sans Regular"],
    },
    paint: {
      "text-color": "#111827",
      "text-halo-color": "rgba(255, 255, 255, 0.85)",
      "text-halo-width": 1.2,
    },
    minzoom: 13,
  });
  // Houses are tiny dots; this invisible layer gives them a finger-sized hit area.
  // Kept modest so a tap on the street line next to a house still reaches the street.
  map.addLayer({
    id: "eshkol-houses-hit",
    type: "circle",
    source: "eshkol-houses",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 5, 16, 8, 18, 11],
      "circle-color": "#000000",
      "circle-opacity": 0,
    },
  });
  map.addLayer({
    id: "eshkol-houses",
    type: "circle",
    source: "eshkol-houses",
    paint: houseCirclePaint("") as never,
  });
  // Clusters are diamonds so they never read as a house (houses are circles).
  // The id stays "clusters-circle" because the click/hover handlers use it.
  map.addLayer({
    id: "clusters-circle",
    type: "symbol",
    source: "clusters",
    layout: {
      "icon-image": "cluster-diamond",
      "icon-size": 0.9,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-color": [
        "case",
        ["==", ["get", "done"], 1],
        COLOR_DONE,
        ["==", ["get", "searched"], 1],
        COLOR_SEARCH,
        COLOR_FILTERED,
      ],
      "icon-halo-color": "#ffffff",
      "icon-halo-width": 1.5,
    },
  });
  // The selected cluster: same source, switched by setFilter (no GeoJSON rebuild on click).
  // Larger, in its streets' color, with a dark ring — readable without relying on color.
  map.addLayer({
    id: "clusters-selected",
    type: "symbol",
    source: "clusters",
    filter: ["==", ["get", "ashkol"], ""],
    layout: {
      "icon-image": "cluster-diamond",
      "icon-size": 1.35,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-color": ["get", "color"],
      "icon-halo-color": "#111827",
      "icon-halo-width": 2.5,
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
    paint: { "line-color": "#ffffff", "line-width": ROUTE_CASING_PX, "line-opacity": 0.95 },
  });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": ["get", "color"], "line-width": ROUTE_LINE_PX, "line-opacity": 1 },
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
  map.addLayer({
    id: "route-arrows",
    type: "symbol",
    source: "route",
    filter: ["==", ["get", "kind"], "arrow"],
    layout: {
      "icon-image": "route-dir",
      "icon-size": ROUTE_LINE_PX / ROUTE_ARROW_PX,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-keep-upright": false,
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "viewport",
    },
  });
}

export function houseCirclePaint(selectedAshkol: string) {
  const chosen: Expr = selectedAshkol
    ? ["==", ["get", "ashkol"], selectedAshkol]
    : ["literal", false];
  return {
    // 20% of the old 7 / 4.5 px, growing only at street-level zoom.
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["zoom"],
      14,
      ["case", chosen, 1.4, 0.9],
      18,
      ["case", chosen, 3, 2],
    ],
    "circle-color": ["get", "color"],
    "circle-opacity": ["case", chosen, 0.95, selectedAshkol ? 0.32 : 0.9],
    "circle-stroke-width": ["case", chosen, 0.5, 0],
    "circle-stroke-color": "#ffffff",
  };
}

export function fitHousePoints(map: MapLibreMap, points: { lat: number; lng: number }[]) {
  if (points.length === 0) return false;
  if (points.length === 1) {
    map.flyTo({ center: [points[0].lng, points[0].lat], zoom: 16 });
    return true;
  }
  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  map.fitBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    { padding: 64, maxZoom: 15 },
  );
  return true;
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}
