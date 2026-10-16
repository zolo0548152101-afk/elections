"use client";

import { useEffect, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { MAP_COLOR } from "@/lib/map-colors";

type LatLng = [number, number];

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
  container.querySelectorAll<HTMLImageElement>(".leaflet-tile-pane img").forEach((img) => {
    if (img.complete && img.naturalWidth > 0) draw(img);
  });
  container.querySelectorAll<HTMLCanvasElement>(".leaflet-overlay-pane canvas").forEach(draw);
  try {
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return null; // tiles without CORS: keep printing the live map
  }
}

function Frame({
  houses,
  paths,
  onReady,
  onPicture,
}: {
  houses: LatLng[];
  paths: LatLng[][];
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
    // Frame on the houses, at least ~350 m across so the streets around them show.
    // Without houses, on the middle of the streets (a long road must not zoom it out).
    const bounds = withMinSpan(coreBounds(houses.length > 0 ? houses : paths.flat(), houses.length > 0 ? 0.02 : 0.15), 0.0032);
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
  onReady,
}: {
  houses: LatLng[];
  streets: { paths: LatLng[][]; done: boolean }[];
  /** The cluster's color on the map: its streets and house dots, as on the main map. */
  color: string;
  onReady: () => void;
}) {
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
        <Frame houses={houses} paths={allPaths} onReady={onReady} onPicture={setPicture} />
        {streets.flatMap((street, i) =>
          street.paths.map((line, j) => (
            <Polyline
              key={`${i}-${j}`}
              positions={line}
              pathOptions={{
                color: street.done ? MAP_COLOR.streetDone : color,
                weight: 6,
                opacity: 0.85,
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
      </MapContainer>
      {/* Printed instead of the live map. */}
      {picture ? <img className="sheet-map-picture" src={picture} alt="" /> : null}
    </div>
  );
}
