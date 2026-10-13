"use client";

import { useEffect, useRef } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

function Frame({
  marker,
  paths,
  onReady,
}: {
  marker: { lat: number; lng: number } | null;
  paths: [number, number][][];
  onReady: () => void;
}) {
  const map = useMap();
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    const points = [
      ...paths.flat(),
      ...(marker ? ([[marker.lat, marker.lng]] as [number, number][]) : []),
    ];
    if (points.length === 0) {
      map.setView([31.5, 34.75], 8);
    } else if (points.length === 1) {
      map.setView(points[0]!, 15);
    } else {
      const lats = points.map((p) => p[0]);
      const lngs = points.map((p) => p[1]);
      map.fitBounds(
        [
          [Math.min(...lats), Math.min(...lngs)],
          [Math.max(...lats), Math.max(...lngs)],
        ],
        { padding: [24, 24], maxZoom: 16 },
      );
    }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      readyRef.current();
    };
    const timer = window.setTimeout(finish, 2800);
    map.whenReady(() => {
      window.setTimeout(finish, 900);
    });
    return () => {
      finished = true;
      window.clearTimeout(timer);
    };
    // Fit once for this map. Paths are fixed for the sheet section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return null;
}

export function SheetMap({
  marker,
  paths,
  onReady,
}: {
  marker: { lat: number; lng: number } | null;
  paths: [number, number][][];
  onReady: () => void;
}) {
  const center = marker ?? paths[0]?.[0] ?? { lat: 31.5, lng: 34.75 };
  const start: [number, number] = Array.isArray(center) ? center : [center.lat, center.lng];

  return (
    <div className="sheet-map">
      <MapContainer
        center={start}
        zoom={14}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Frame marker={marker} paths={paths} onReady={onReady} />
        {paths.map((line, i) => (
          <Polyline
            key={i}
            positions={line}
            pathOptions={{ color: "#c45c26", weight: 4, opacity: 0.9 }}
          />
        ))}
        {marker && (
          <CircleMarker
            center={[marker.lat, marker.lng]}
            radius={9}
            pathOptions={{
              color: "#0f1c2e",
              fillColor: "#2f6fed",
              fillOpacity: 0.95,
              weight: 2,
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}
