"use client";

import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type VectorTileSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Turbopack rewrites the library chunk, so the relative worker URL 404s.
setWorkerUrl("/maplibre-gl-worker.mjs");
import type { ClusterView } from "./ClusterTable";
import type { Feature } from "geojson";

type SearchHit = {
  id: string;
  name_he: string;
  lat: number;
  lng: number;
  ashkol: string | null;
  done: boolean;
  near_settlement?: string | null;
};

type MapFocus = { lat: number; lng: number };

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtInt(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("he-IL") : "—";
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
    map_lat: null,
    map_lng: null,
  };
}

function clusterPopupHtml(c: ClusterView) {
  const row = (label: string, value: string) =>
    `<div>${esc(label)}: <bdi dir="ltr">${esc(value)}</bdi></div>`;
  return `<div dir="rtl" class="popup"><strong>${esc(c.settlement_name)}</strong>${row("אשכול", c.ashkol)}${row("בז״ב", fmtInt(c.bzb))}${row("מצביעים", fmtInt(c.voters))}${row("כשרים", fmtInt(c.valid))}${row("הצבעה", fmtPct(c.turnout_pct))}${row("קולות ימין", fmtInt(c.right_votes))}${row("ימין", fmtPct(c.right_pct))}${row("קלפיות", fmtInt(c.ballot_count))}</div>`;
}

export function StreetMap({
  clusters,
  focus,
}: {
  clusters: ClusterView[];
  focus?: MapFocus | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [status, setStatus] = useState("טוען מפה…");
  const [selectedAshkol, setSelectedAshkol] = useState<string>("");
  const [picked, setPicked] = useState<ClusterView | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MapLibreMap({
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
        },
        layers: [
          { id: "osm", type: "raster", source: "osm" },
          {
            id: "streets-line",
            type: "line",
            source: "streets",
            "source-layer": "streets",
            paint: {
              "line-color": [
                "case",
                ["==", ["get", "done"], 1],
                "#16a34a",
                "#2563eb",
              ],
              "line-width": [
                "case",
                ["==", ["get", "done"], 1],
                5,
                3,
              ],
              "line-opacity": 0.85,
            },
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
              "circle-radius": 7,
              "circle-color": "#c45c26",
              "circle-stroke-width": 1,
              "circle-stroke-color": "#fff",
            },
          },
          {
            id: "highlight-line",
            type: "line",
            source: "highlight",
            paint: {
              "line-color": "#f59e0b",
              "line-width": 7,
              "line-opacity": 0.95,
            },
          },
        ],
      },
      center: [34.8, 31.5],
      zoom: 8,
    });

    map.addControl(new NavigationControl(), "top-left");
    map.on("load", () => setStatus("לחצו על רחוב לסימון · חיפוש לפי שם עברי"));

    map.on("click", "streets-line", async (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const id = String(f.properties?.id ?? "");
      const name = String(f.properties?.name_he ?? "");
      const done = Number(f.properties?.done ?? 0) === 1;
      if (!id) return;
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
        src.setTiles?.([`${window.location.origin}/api/tiles/{z}/{x}/{y}?t=${Date.now()}`]);
        map.triggerRepaint();
        setStatus(done ? `הוסר סימון: ${name}` : `סומן בוצע: ${name}`);
      } else {
        setStatus("שגיאה בסימון");
      }
    });

    map.on("click", "clusters-circle", (e: MapLayerMouseEvent) => {
      const raw = e.features?.[0]?.properties;
      if (!raw) return;
      const cluster = clusterFromProps(raw as Record<string, unknown>);
      setPicked(cluster);
      setSelectedAshkol(cluster.ashkol);
      new Popup({ closeButton: true, closeOnClick: false, maxWidth: "280px" })
        .setLngLat(e.lngLat)
        .setHTML(clusterPopupHtml(cluster))
        .addTo(map);
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

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const features = clusters
      .filter((c) => c.map_lat != null && c.map_lng != null)
      .map((c) => ({
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
        },
        geometry: {
          type: "Point" as const,
          coordinates: [c.map_lng!, c.map_lat!],
        },
      }));
    const apply = () => {
      const src = map.getSource("clusters") as GeoJSONSource | undefined;
      src?.setData({ type: "FeatureCollection", features });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [clusters]);

  useEffect(() => {
    if (!picked) return;
    if (clusters.some((c) => c.ashkol === picked.ashkol)) return;
    setPicked(null);
    setSelectedAshkol("");
  }, [clusters, picked]);

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

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/streets/search?q=${encodeURIComponent(q.trim())}`);
      if (!res.ok) return;
      const data = await res.json();
      setHits(data.results ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function goToHit(hit: SearchHit) {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [hit.lng, hit.lat], zoom: 15 });
    setQ(hit.name_he);
    setHits([]);
    // Fetch bbox streets to highlight geometry
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

  async function markClusterStreets(done: boolean) {
    if (!selectedAshkol) return;
    setStatus("מעדכן רחובות האשכול…");
    const res = await fetch(`/api/clusters/${encodeURIComponent(selectedAshkol)}/mark-streets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
    const data = await res.json();
    setStatus(
      data.updated
        ? `${done ? "סומנו" : "הוסרו"} ${data.updated} רחובות באשכול ${selectedAshkol}`
        : data.message || "אין רחובות מקושרים לאשכול (ממתינים לקובץ קישור)",
    );
    const map = mapRef.current;
    if (map) {
      const src = map.getSource("streets") as VectorTileSource & {
        setTiles?: (tiles: string[]) => void;
      };
      src.setTiles?.([`${window.location.origin}/api/tiles/{z}/{x}/{y}?t=${Date.now()}`]);
    }
  }

  return (
    <div className="street-map-wrap">
      <div className="street-map-toolbar">
        <label className="search-box">
          חיפוש רחוב
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="שם בעברית…"
          />
          {hits.length > 0 && (
            <ul className="search-hits">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => goToHit(h)}>
                    {h.name_he}
                    {h.near_settlement ? ` · ${h.near_settlement}` : ""}
                    {h.done ? " ✓" : ""}
                    {h.ashkol ? ` · אשכול ${h.ashkol}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>
        <label>
          אשכול
          <select
            value={selectedAshkol}
            onChange={(e) => {
              const ashkol = e.target.value;
              setSelectedAshkol(ashkol);
              const cluster = clusters.find((c) => c.ashkol === ashkol) ?? null;
              setPicked(cluster);
              if (cluster?.map_lng != null && cluster.map_lat != null) {
                mapRef.current?.flyTo({
                  center: [cluster.map_lng, cluster.map_lat],
                  zoom: 14,
                });
              }
            }}
          >
            <option value="">בחרו אשכול</option>
            {clusters.map((c) => (
              <option key={c.ashkol} value={c.ashkol}>
                {c.settlement_name} · {c.ashkol}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="export"
          disabled={!selectedAshkol}
          onClick={() => markClusterStreets(true)}
        >
          סמן אשכול כבוצע
        </button>
        <button
          type="button"
          className="reset"
          disabled={!selectedAshkol}
          onClick={() => markClusterStreets(false)}
        >
          נקה אשכול
        </button>
        <p className="map-status">{status}</p>
      </div>
      <aside className="cluster-card" aria-live="polite">
        {picked ? (
          <>
            <h2>
              {picked.settlement_name} · אשכול <bdi dir="ltr">{picked.ashkol}</bdi>
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
          </>
        ) : (
          <p>לחצו על נקודת אשכול כדי לראות כאן את בז״ב, המצביעים, ההצבעה והימין, לצד הרחובות.</p>
        )}
      </aside>
      <div ref={containerRef} className="street-map-canvas" />
      <p className="map-credit">
        © OpenStreetMap contributors · data available under ODbL · Hebrew names from OSM
      </p>
    </div>
  );
}
