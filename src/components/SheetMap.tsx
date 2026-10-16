"use client";

import { useEffect, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { MAP_COLOR } from "@/lib/map-colors";

type LatLng = [number, number];

/** A route stage as the sheet receives it (see SheetRouteStage). */
export type SheetRoute = {
  stage_no: number;
  color: string;
  point: LatLng | null;
  lines: { coords: LatLng[]; done: boolean }[];
}[];

/** Numbers on the map: drawn as DOM labels on screen, and into the printed picture. */
type MapLabel = { at: LatLng; text: string; color: string; round: boolean };

function routeLabels(route: SheetRoute): MapLabel[] {
  const out: MapLabel[] = [];
  for (const stage of route) {
    if (stage.point) out.push({ at: stage.point, text: String(stage.stage_no), color: stage.color, round: true });
    const first = stage.lines[0]?.coords;
    if (first && first.length >= 2) {
      out.push({ at: first[Math.floor(first.length / 2)]!, text: `שלב ${stage.stage_no}`, color: stage.color, round: false });
    }
  }
  return out;
}

/** Every sheet map on the page, so the print button can wait for fresh pictures. */
const sheetMaps = new Set<{ capture: () => Promise<void> }>();

/** Make sure every map has an up-to-date picture before printing. */
export async function prepareSheetPrint() {
  await Promise.all([...sheetMaps].map((m) => m.capture()));
}

/** Bounds of the middle of the points (trimming `trim` at each end), so a stray point does not zoom out. */
function coreBounds(points: LatLng[], trim = 0.02): [LatLng, LatLng] | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p[0]).sort((a, b) => a - b);
  const lngs = points.map((p) => p[1]).sort((a, b) => a - b);
  const cut = points.length >= 10 ? Math.floor(points.length * trim) : 0;
  const lo = cut;
  const hi = points.length - 1 - cut;
  return [
    [lats[lo]!, lngs[lo]!],
    [lats[hi]!, lngs[hi]!],
  ];
}

/** Grow bounds to at least `span` degrees each way, around their center. */
function withMinSpan(b: [LatLng, LatLng] | null, span: number): [LatLng, LatLng] | null {
  if (!b) return null;
  const [[s, w], [n, e]] = b;
  const lat = (s + n) / 2;
  const lng = (w + e) / 2;
  const dLat = Math.max(n - s, span) / 2;
  const dLng = Math.max(e - w, span * 1.2) / 2;
  return [
    [lat - dLat, lng - dLng],
    [lat + dLat, lng + dLng],
  ];
}

/**
 * Draw what the map shows (tiles, then streets and houses) into one image.
 * Browsers often drop Leaflet's positioned tiles when printing; a plain image always prints.
 */
function snapshot(
  container: HTMLElement,
  labels: { x: number; y: number; label: MapLabel }[] = [],
): string | null {
  const box = container.getBoundingClientRect();
  if (box.width < 10 || box.height < 10) return null;
  const scale = Math.min(2, window.devicePixelRatio || 1) * 1.5;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(box.width * scale);
  canvas.height = Math.round(box.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#f2efe9";
  ctx.fillRect(0, 0, box.width, box.height);
  const draw = (el: CanvasImageSource & Element) => {
    const r = el.getBoundingClientRect();
    ctx.drawImage(el, r.left - box.left, r.top - box.top, r.width, r.height);
  };
  container.querySelectorAll<HTMLImageElement>(".leaflet-tile-pane img").forEach((img) => {
    if (img.complete && img.naturalWidth > 0) draw(img);
  });
  container.querySelectorAll<HTMLCanvasElement>(".leaflet-overlay-pane canvas").forEach(draw);
  // Route numbers (on screen they are DOM tooltips, which a canvas cannot copy).
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const { x, y, label } of labels) {
    if (label.round) {
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fillStyle = label.color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "800 12px Heebo, Arial, sans-serif";
      ctx.fillText(label.text, x, y + 0.5);
    } else {
      ctx.font = "800 12px Heebo, Arial, sans-serif";
      const w = ctx.measureText(label.text).width + 12;
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - 10, w, 20, 10);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = label.color;
      ctx.stroke();
      ctx.fillStyle = label.color;
      ctx.direction = "rtl";
      ctx.fillText(label.text, x, y + 0.5);
    }
  }
  try {
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return null; // tiles without CORS: keep printing the live map
  }
}

function Frame({
  houses,
  paths,
  routePoints,
  labels,
  onReady,
  onPicture,
}: {
  houses: LatLng[];
  paths: LatLng[][];
  routePoints: LatLng[];
  labels: MapLabel[];
  onReady: () => void;
  onPicture: (url: string | null) => void;
}) {
  const map = useMap();
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const pictureRef = useRef(onPicture);
  pictureRef.current = onPicture;

  useEffect(() => {
    // Frame on the houses (where the doors are). Whole streets can run across the city.
    // Frame on the houses and the planned route (points and lines), at least ~350 m across.
    // Without either, on the middle of the streets (a long road must not zoom it out).
    const routePts = [...routePoints];
    const core = houses.length > 0 || routePts.length > 0;
    const bounds = withMinSpan(
      coreBounds(core ? [...houses, ...routePts] : paths.flat(), core ? 0.02 : 0.15),
      0.0032,
    );
    const frame = () => {
      map.invalidateSize({ animate: false });
      if (!bounds) {
        map.setView([31.5, 34.75], 8, { animate: false });
      } else {
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 18, animate: false });
      }
    };
    frame();

    // Wait until the tiles of the current view have loaded (or give up after 4s).
    const settle = () =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        let loading = 0;
        map.eachLayer((layer) => {
          const tiles = layer as unknown as {
            isLoading?: () => boolean;
            once?: (e: string, f: () => void) => void;
          };
          if (typeof tiles.isLoading === "function" && tiles.isLoading()) {
            loading += 1;
            tiles.once?.("load", () => {
              loading -= 1;
              if (loading <= 0) window.setTimeout(finish, 200);
            });
          }
        });
        if (loading === 0) window.setTimeout(finish, 200);
        window.setTimeout(finish, 4000);
      });

    const capture = async () => {
      await settle();
      const placed = labels.map((label) => {
        const p = map.latLngToContainerPoint(label.at);
        return { x: p.x, y: p.y, label };
      });
      pictureRef.current(snapshot(map.getContainer(), placed));
    };
    const entry = { capture };
    sheetMaps.add(entry);

    // A new picture whenever the map moves and settles.
    let timer: number | undefined;
    const recapture = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void capture(), 300);
    };
    map.on("moveend", recapture);
    map.on("zoomend", recapture);

    let finished = false;
    void capture().then(() => {
      if (finished) return;
      finished = true;
      readyRef.current();
    });

    // Window resized: keep the cluster in frame.
    let resizeTimer: number | undefined;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(frame, 200);
    };
    window.addEventListener("resize", onResize);

    return () => {
      finished = true;
      sheetMaps.delete(entry);
      map.off("moveend", recapture);
      map.off("zoomend", recapture);
      window.clearTimeout(timer);
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
    };
    // Fit once for this map. Data is fixed for the sheet section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}

export function SheetMap({
  houses,
  streets,
  color,
  route = [],
  onReady,
}: {
  houses: LatLng[];
  streets: { paths: LatLng[][]; done: boolean }[];
  /** The cluster's color on the map: its streets and house dots, as on the main map. */
  color: string;
  /** The planned route, drawn over the streets. */
  route?: SheetRoute;
  onReady: () => void;
}) {
  const labels = routeLabels(route);
  const allPaths = streets.flatMap((s) => s.paths);
  const start: LatLng = houses[0] ?? allPaths[0]?.[0] ?? [31.5, 34.75];
  const [picture, setPicture] = useState<string | null>(null);

  return (
    <div className={picture ? "sheet-map has-picture" : "sheet-map"}>
      <MapContainer
        center={start}
        zoom={16}
        scrollWheelZoom={false}
        trackResize={false}
        fadeAnimation={false}
        zoomAnimation={false}
        preferCanvas
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          crossOrigin="anonymous"
        />
        <Frame
          houses={houses}
          paths={allPaths}
          routePoints={route.flatMap((stage) => [
            ...(stage.point ? [stage.point] : []),
            ...stage.lines.flatMap((line) => line.coords),
          ])}
          labels={labels}
          onReady={onReady}
          onPicture={setPicture}
        />
        {streets.flatMap((street, i) =>
          street.paths.map((line, j) => (
            <Polyline
              key={`${i}-${j}`}
              positions={line}
              pathOptions={{
                color: street.done ? MAP_COLOR.streetDone : color,
                weight: 6,
                opacity: route.length > 0 ? 0.45 : 0.7,
              }}
            />
          )),
        )}
        {houses.map((h, i) => (
          <CircleMarker
            key={i}
            center={h}
            radius={4}
            pathOptions={{ color: "#ffffff", weight: 1.5, fillColor: color, fillOpacity: 1 }}
          />
        ))}
        {/* The route: a white casing, then the stage color (green when done). */}
        {route.flatMap((stage) =>
          stage.lines.map((line, i) => (
            <Polyline
              key={`rc-${stage.stage_no}-${i}`}
              positions={line.coords}
              pathOptions={{ color: "#ffffff", weight: 7, opacity: 0.8 }}
            />
          )),
        )}
        {route.flatMap((stage) =>
          stage.lines.map((line, i) => (
            <Polyline
              key={`r-${stage.stage_no}-${i}`}
              positions={line.coords}
              pathOptions={{
                color: line.done ? MAP_COLOR.streetDone : stage.color,
                weight: 4,
                opacity: 0.95,
              }}
            />
          )),
        )}
        {labels.map((label, i) =>
          label.round ? (
            <CircleMarker
              key={`l-${i}`}
              center={label.at}
              radius={11}
              pathOptions={{ color: "#ffffff", weight: 2.5, fillColor: label.color, fillOpacity: 1 }}
            >
              <Tooltip permanent direction="center" className="sheet-map-label is-round">
                {label.text}
              </Tooltip>
            </CircleMarker>
          ) : (
            <CircleMarker key={`l-${i}`} center={label.at} radius={0} pathOptions={{ opacity: 0, fillOpacity: 0 }}>
              <Tooltip
                permanent
                direction="center"
                className="sheet-map-label"
              >
                <span style={{ color: label.color, borderColor: label.color }}>{label.text}</span>
              </Tooltip>
            </CircleMarker>
          ),
        )}
      </MapContainer>
      {/* Printed instead of the live map. */}
      {picture ? <img className="sheet-map-picture" src={picture} alt="" /> : null}
    </div>
  );
}
