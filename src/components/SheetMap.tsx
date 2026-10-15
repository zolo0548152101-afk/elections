"use client";

import { useEffect, useRef } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

type LatLng = [number, number];

/** Every sheet map on the page, so printing can resize and re-frame them first. */
const sheetMaps = new Set<{ refit: () => void; settle: () => Promise<void> }>();

/**
 * Size the maps exactly as on paper (A4), frame them on the cluster again and wait for
 * the tiles. Leaflet keeps pixel offsets, so without this the printed map is shifted.
 */
export async function prepareSheetPrint() {
  document.body.classList.add("sheet-printing");
  for (const m of sheetMaps) m.refit();
  await Promise.all([...sheetMaps].map((m) => m.settle()));
}

export function endSheetPrint() {
  document.body.classList.remove("sheet-printing");
  for (const m of sheetMaps) m.refit();
}

/** Bounds of the middle 96% of points, so one stray address does not zoom the map out. */
function coreBounds(points: LatLng[]): [LatLng, LatLng] | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p[0]).sort((a, b) => a - b);
  const lngs = points.map((p) => p[1]).sort((a, b) => a - b);
  const cut = points.length >= 20 ? Math.floor(points.length * 0.02) : 0;
  const lo = cut;
  const hi = points.length - 1 - cut;
  return [
    [lats[lo]!, lngs[lo]!],
    [lats[hi]!, lngs[hi]!],
  ];
}

function Frame({
  houses,
  paths,
  onReady,
}: {
  houses: LatLng[];
  paths: LatLng[][];
  onReady: () => void;
}) {
  const map = useMap();
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    // Frame on the houses (where the doors are). Whole streets can run across the city.
    const bounds = coreBounds(houses.length >= 2 ? houses : paths.flat());
    const frame = () => {
      map.invalidateSize({ animate: false });
      if (!bounds) {
        map.setView([31.5, 34.75], 8, { animate: false });
      } else if (bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]) {
        map.setView(bounds[0], 17, { animate: false });
      } else {
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 18, animate: false });
      }
    };
    frame();

    // Wait until the tiles of the current view have loaded (or give up after 2.5s).
    const settle = () =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        let layers = 0;
        map.eachLayer((layer) => {
          const tiles = layer as unknown as { isLoading?: () => boolean; once?: (e: string, f: () => void) => void };
          if (typeof tiles.isLoading === "function" && tiles.isLoading()) {
            layers += 1;
            tiles.once?.("load", () => {
              layers -= 1;
              if (layers <= 0) window.setTimeout(finish, 150);
            });
          }
        });
        if (layers === 0) window.setTimeout(finish, 150);
        window.setTimeout(finish, 2500);
      });
    const entry = { refit: frame, settle };
    sheetMaps.add(entry);

    // Ctrl+P without the button: still resize and re-frame before the page is laid out.
    const before = () => {
      document.body.classList.add("sheet-printing");
      frame();
    };
    const after = () => {
      document.body.classList.remove("sheet-printing");
      frame();
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    // Our own resize handling (Leaflet's is off): never while printing, so the
    // printed map keeps the tiles it already loaded.
    let resizeTimer: number | undefined;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (document.body.classList.contains("sheet-printing")) return;
        if (window.matchMedia("print").matches) return;
        frame();
      }, 200);
    };
    window.addEventListener("resize", onResize);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      readyRef.current();
    };
    const timer = window.setTimeout(finish, 3000);
    map.whenReady(() => {
      window.setTimeout(finish, 1200);
    });
    return () => {
      finished = true;
      window.clearTimeout(timer);
      sheetMaps.delete(entry);
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(resizeTimer);
    };
    // Fit once for this map. Data is fixed for the sheet section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}

export function SheetMap({
  houses,
  streets,
  onReady,
}: {
  houses: LatLng[];
  streets: { paths: LatLng[][]; done: boolean }[];
  onReady: () => void;
}) {
  const allPaths = streets.flatMap((s) => s.paths);
  const start: LatLng = houses[0] ?? allPaths[0]?.[0] ?? [31.5, 34.75];

  return (
    <div className="sheet-map">
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
        />
        <Frame houses={houses} paths={allPaths} onReady={onReady} />
        {streets.flatMap((street, i) =>
          street.paths.map((line, j) => (
            <Polyline
              key={`${i}-${j}`}
              positions={line}
              pathOptions={{
                color: street.done ? "#16a34a" : "#c45c26",
                weight: 6,
                opacity: 0.8,
              }}
            />
          )),
        )}
        {houses.map((h, i) => (
          <CircleMarker
            key={i}
            center={h}
            radius={3}
            pathOptions={{ color: "#0f1c2e", weight: 1, fillColor: "#ffffff", fillOpacity: 1 }}
          />
        ))}
      </MapContainer>
    </div>
  );
}
