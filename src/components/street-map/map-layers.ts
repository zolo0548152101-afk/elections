/**
 * MapLibre layers, paint expressions and small map helpers for StreetMap.
 * Pure functions of the map instance — no React state lives here.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import { streetsTilePath } from "@/lib/tiles-version";
import { MAP_COLOR, STAGE_COLOR } from "@/lib/map-colors";

/** Street status. Cluster diamonds are blue. */
export const COLOR_ASSIGNED = MAP_COLOR.assigned;
export const COLOR_DONE = MAP_COLOR.streetDone;
export const COLOR_FILTERED = STAGE_COLOR.pending;
export const COLOR_SEARCH = MAP_COLOR.search;
/** Cluster with some streets done (בתהליך). Pending is COLOR_FILTERED (blue), done is COLOR_DONE (green). */
export const COLOR_PARTIAL = STAGE_COLOR.partial;

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

/** Opacity of colored street and route lines: strong enough to read the color, light enough to read the name. */
export const LINE_ALPHA = 0.55;

/** Streets of other clusters while one cluster is selected. */
export const COLOR_MUTED = MAP_COLOR.muted;

/** City-matched lines. The selected eshkol keeps its color; every other line goes grey. */
export function eshkolLinePaint(selectedAshkol: string, doneIds: string[]) {
  const chosen: Expr = selectedAshkol
    ? ["==", ["get", "ashkol"], selectedAshkol]
    : ["literal", true];
  const done: Expr =
    doneIds.length > 0
      ? ["in", ["get", "id"], ["literal", doneIds]]
      : ["literal", false];
  return {
    "line-color": [
      "case",
      ["all", chosen, done],
      COLOR_DONE,
      chosen,
      ["get", "color"],
      COLOR_MUTED,
    ],
    "line-width": ["case", chosen, 6.5, 3],
    // Translucent so the street name drawn under/over the line stays readable.
    "line-opacity": ["case", chosen, LINE_ALPHA, selectedAshkol ? 0.35 : LINE_ALPHA],
  };
}

export function lineVertices(geometry: { coordinates: unknown }) {
  const points: { lat: number; lng: number }[] = [];
  const walk = (node: unknown) => {
    if (!Array.isArray(node) || node.length === 0) return;
    if (typeof node[0] === "number") {
      points.push({ lng: Number(node[0]), lat: Number(node[1]) });
      return;
    }
    for (const child of node) walk(child);
  };
  walk(geometry.coordinates);
  return points;
}

export function streetLinePaint(
  linkedAshkols: string[],
  selectedAshkol = "",
  streetId = "",
  colors: Map<string, string> = new Map(),
  /** Every line of the selected cluster, including lines it shares with a neighbour cluster. */
  selectedStreetIds: string[] = [],
) {
  const done = doneFlag();
  const linked = linkedFlag(linkedAshkols);
  const selectedStreet: Expr = streetId ? ["==", ["get", "id"], streetId] : ["literal", false];
  const inCluster: Expr = !selectedAshkol
    ? ["literal", false]
    : selectedStreetIds.length > 0
      ? ["any", ["==", ["get", "ashkol"], selectedAshkol], ["in", ["get", "id"], ["literal", selectedStreetIds]]]
      : ["==", ["get", "ashkol"], selectedAshkol];
  if (!selectedAshkol) {
    return {
      "line-color": ["case", done, COLOR_DONE, clusterColorExpr(colors)],
      "line-width": ["case", selectedStreet, 8, done, 5, ["==", linked, 1], 4.5, 4],
      "line-opacity": 0.9,
    };
  }
  // A cluster is selected: only its streets keep the cluster colour, the rest go soft grey.
  const color = colors.get(selectedAshkol) ?? COLOR_ASSIGNED;
  return {
    "line-color": ["case", ["all", inCluster, done], COLOR_DONE, inCluster, color, COLOR_MUTED],
    "line-width": ["case", selectedStreet, 8, inCluster, 6.5, 3],
    "line-opacity": ["case", selectedStreet, 1, inCluster, 1, 0.55],
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
  map.addSource("eshkol-streets", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  const hidden: Expr = ["literal", false];
  // The tile street layer stays hidden. Color comes from eshkol-streets, so one
  // road can be drawn for every eshkol that lists it. Place names stay on top.
  const firstBasemapLabel = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
  map.addLayer(
    {
      id: "streets-line",
      type: "line",
      source: "streets",
      "source-layer": "streets",
      filter: hidden as never,
      layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
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
      visibility: "none",
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
  map.addLayer(
    {
      id: "eshkol-streets",
      type: "line",
      source: "eshkol-streets",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: eshkolLinePaint("", []) as never,
    },
    firstBasemapLabel,
  );
  // Small house dots. They are not a click target; the diamond and the street line are.
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
      // stage: 0 טרם התחיל (blue), 1 בתהליך (orange), 2 הושלם (green).
      "icon-color": [
        "match",
        ["get", "stage"],
        2,
        COLOR_DONE,
        1,
        COLOR_PARTIAL,
        ["case", ["==", ["get", "searched"], 1], COLOR_SEARCH, COLOR_FILTERED],
      ],
      "icon-halo-color": "#ffffff",
      "icon-halo-width": 1.5,
    },
  });
  // The selected cluster: same source, switched by setFilter (no GeoJSON rebuild on click).
  // Larger, in its streets' color, with a dark ring so it stands out from the other diamonds.
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
      // Selected: takes the color of its streets, so the diamond and its streets read as one.
      "icon-color": ["coalesce", ["get", "color"], COLOR_FILTERED],
      "icon-halo-color": "#111827",
      "icon-halo-width": 2.5,
    },
  });
  // Route and highlight lines sit under the basemap labels too, translucent,
  // so the name of the street being drawn on stays visible.
  map.addLayer(
    {
      id: "highlight-line",
      type: "line",
      source: "highlight",
      paint: { "line-color": MAP_COLOR.highlight, "line-width": 7, "line-opacity": LINE_ALPHA },
    },
    firstBasemapLabel,
  );
  map.addLayer(
    {
      id: "route-casing",
      type: "line",
      source: "route",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": "#ffffff", "line-width": ROUTE_CASING_PX, "line-opacity": 0.35 },
    },
    firstBasemapLabel,
  );
  map.addLayer(
    {
      id: "route-line",
      type: "line",
      source: "route",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": ["get", "color"], "line-width": ROUTE_LINE_PX, "line-opacity": LINE_ALPHA + 0.1 },
    },
    firstBasemapLabel,
  );
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
    "circle-color": selectedAshkol ? ["case", chosen, ["get", "color"], COLOR_MUTED] : ["get", "color"],
    "circle-opacity": ["case", chosen, 0.95, selectedAshkol ? 0.5 : 0.9],
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
