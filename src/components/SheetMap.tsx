"use client";

import { useEffect, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { MAP_COLOR, MAP_STYLE } from "@/lib/map-colors";

type LatLng = [number, number];

/** A route stage as the sheet receives it (see SheetRouteStage). */
export type SheetRoute = {
  stage_no: number;
  color: string;
  point: LatLng | null;
  lines: { coords: LatLng[]; done: boolean; draw: boolean; finished: boolean }[];
}[];

/**
 * Text on the map. Painted on a canvas layer over the map by one function (drawLabels),
 * so the screen and the printed picture show exactly the same labels.
 */
type MapLabel =
  | { kind: "point"; at: LatLng; text: string; color: string } // number in the meeting point
  | { kind: "name"; at: LatLng; text: string; color: string } // name above the point
  | { kind: "tag"; at: LatLng; text: string; color: string } // "שלב N" on the line
  | { kind: "end"; at: LatLng; text: string; color: string }; // A / B at a drawn line's ends

function routeLabels(route: SheetRoute): MapLabel[] {
  const out: MapLabel[] = [];
  for (const stage of route) {
    const first = stage.lines[0]?.coords;
    if (first && first.length >= 2) {
      out.push({ kind: "tag", at: first[Math.floor(first.length / 2)]!, text: `שלב ${stage.stage_no}`, color: stage.color });
    }
    for (const line of stage.lines) {
      if (!line.draw || line.coords.length < 2) continue;
      out.push({ kind: "end", at: line.coords[0]!, text: "A", color: stage.color });
      if (line.finished) out.push({ kind: "end", at: line.coords[line.coords.length - 1]!, text: "B", color: stage.color });
    }
    if (stage.point) {
      out.push({ kind: "point", at: stage.point, text: String(stage.stage_no), color: stage.color });
      out.push({
        kind: "name",
        at: stage.point,
        text: stage.stage_no === 1 ? "נקודת התחלה" : `נקודת קיבוץ ${stage.stage_no}`,
        color: stage.color,
      });
    }
  }
  return out;
}

const LABEL_FONT = "800 12px Heebo, Arial, sans-serif";

function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "#ffffff";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Paint the labels, with x/y in map-container pixels. */
function drawLabels(ctx: CanvasRenderingContext2D, placed: { x: number; y: number; label: MapLabel }[]) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = LABEL_FONT;
  ctx.direction = "rtl";
  for (const { x, y, label } of placed) {
    if (label.kind === "point") {
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label.text, x, y + 0.5);
    } else if (label.kind === "name") {
      haloText(ctx, label.text, x, y - MAP_STYLE.pointRadius - 10, "#102033");
    } else if (label.kind === "end") {
      haloText(ctx, label.text, x, y - 10, "#111111");
    } else {
      const w = ctx.measureText(label.text).width + 12;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - 10, w, 20, 10);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = label.color;
      ctx.stroke();
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, x, y + 0.5);
    }
  }
  ctx.restore();
}

/** Canvas over the map with the labels; redrawn whenever the map moves. */
function LabelLayer({ labels }: { labels: MapLabel[] }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const canvas = document.createElement("canvas");
    canvas.className = "sheet-map-labels";
    container.appendChild(canvas);
    const redraw = () => {
      const { x: w, y: h } = map.getSize();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawLabels(
        ctx,
        labels.map((label) => {
          const p = map.latLngToContainerPoint(label.at);
          return { x: p.x, y: p.y, label };
        }),
      );
    };
    redraw();
    map.on("move zoom viewreset resize", redraw);
    return () => {
      map.off("move zoom viewreset resize", redraw);
      canvas.remove();
    };
  }, [map, labels]);
  return null;
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
 * Draw what the map shows (tiles, lines, houses, labels) into one image.
 * Browsers often drop Leaflet's positioned tiles when printing; a plain image always prints.
 */
function snapshot(container: HTMLElement): string | null {
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
  // Tiles, then lines / houses / joints / points (Leaflet's canvas), then the labels layer.
  container.querySelectorAll<HTMLImageElement>(".leaflet-tile-pane img").forEach((img) => {
    if (img.complete && img.naturalWidth > 0) draw(img);
  });
  container.querySelectorAll<HTMLCanvasElement>(".leaflet-overlay-pane canvas").forEach(draw);
  container.querySelectorAll<HTMLCanvasElement>("canvas.sheet-map-labels").forEach(draw);
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
  onReady,
  onPicture,
}: {
  houses: LatLng[];
  paths: LatLng[][];
  routePoints: LatLng[];
  onReady: () => void;
  onPicture: (url: string | null) => void;
}) {
  const map = useMap();
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const pictureRef = useRef(onPicture);
  pictureRef.current = onPicture;

  useEffect(() => {
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
      pictureRef.current(snapshot(map.getContainer()));
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
  const [labels] = useState(() => routeLabels(route));
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
          onReady={onReady}
          onPicture={setPicture}
        />
        {/* The cluster's streets and houses, as on the main map. */}
        {streets.flatMap((street, i) =>
          street.paths.map((line, j) => (
            <Polyline
              key={`${i}-${j}`}
              positions={line}
              pathOptions={{
                color: street.done ? MAP_COLOR.streetDone : color,
                weight: 6,
                opacity: MAP_STYLE.streetAlpha,
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
        {/* The route, with the map's widths and transparency: casing, line, joints, points. */}
        {route.flatMap((stage) =>
          stage.lines.map((line, i) => (
            <Polyline
              key={`rc-${stage.stage_no}-${i}`}
              positions={line.coords}
              pathOptions={{ color: "#ffffff", weight: MAP_STYLE.routeCasingPx, opacity: MAP_STYLE.routeCasingAlpha }}
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
                weight: MAP_STYLE.routeLinePx,
                opacity: MAP_STYLE.routeLineAlpha,
              }}
            />
          )),
        )}
        {route.flatMap((stage) =>
          stage.lines
            .filter((line) => line.draw)
            .flatMap((line, i) =>
              line.coords.map((c, j) => (
                <CircleMarker
                  key={`j-${stage.stage_no}-${i}-${j}`}
                  center={c}
                  radius={MAP_STYLE.jointRadius}
                  pathOptions={{
                    color: stage.color,
                    weight: 1.5,
                    opacity: MAP_STYLE.jointStrokeAlpha,
                    fillColor: "#ffffff",
                    fillOpacity: MAP_STYLE.jointFillAlpha,
                  }}
                />
              )),
            ),
        )}
        {route
          .filter((stage) => stage.point)
          .map((stage) => (
            <CircleMarker
              key={`p-${stage.stage_no}`}
              center={stage.point!}
              radius={MAP_STYLE.pointRadius}
              pathOptions={{ color: "#ffffff", weight: 2, fillColor: stage.color, fillOpacity: 1 }}
            />
          ))}
        <LabelLayer labels={labels} />
      </MapContainer>
      {/* Printed instead of the live map. */}
      {picture ? <img className="sheet-map-picture" src={picture} alt="" /> : null}
    </div>
  );
}
