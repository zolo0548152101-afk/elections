"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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

type Institution = { id: number; name: string };

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

function streetPopupHtml(name: string, ashkol: string | null) {
  const ashkolLine =
    ashkol && ashkol.trim()
      ? `<div>אשכול: <bdi dir="ltr">${esc(ashkol)}</bdi></div>`
      : "";
  return `<div dir="rtl" class="popup"><strong>${esc(name)}</strong>${ashkolLine}</div>`;
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
  const streetPopupRef = useRef<Popup | null>(null);
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
  const [linkInstitutionId, setLinkInstitutionId] = useState("");
  const searchBoxRef = useRef<HTMLLabelElement | null>(null);

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
    if (me.role === "super_admin" || me.role === "area_manager") {
      fetch("/api/institutions")
        .then((r) => r.json())
        .then((data) => setInstitutions(data.institutions ?? []))
        .catch(() => {});
    } else if (me.institution_id) {
      setLinkInstitutionId(String(me.institution_id));
    }
  }, [me]);

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
              "line-color": "#2563eb",
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
    map.on("load", () => setStatus("לחצו על רחוב לסימון · חיפוש עיר או רחוב"));

    map.on("click", "streets-line", async (e: MapLayerMouseEvent) => {
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

      streetPopupRef.current?.remove();
      streetPopupRef.current = new Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: "260px",
      })
        .setLngLat(e.lngLat)
        .setHTML(streetPopupHtml(name, ashkol))
        .addTo(map);

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
        src.setTiles?.([`${window.location.origin}/api/tiles/{z}/{x}/{y}?t=${Date.now()}`]);
        map.triggerRepaint();
        setPickedStreet({ ...street, done: !done });
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
      streetPopupRef.current?.remove();
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
    map.flyTo({ center: [city.lng, city.lat], zoom: 13 });
    setQ(`${city.name_he} `);
    clearHits();
    setSearchOpen(true);
    setStatus(`עיר: ${city.name_he} · המשיכו להקליד שם רחוב`);
  }

  async function goToStreet(hit: SearchStreet) {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [hit.lng, hit.lat], zoom: 15 });
    setQ(
      hit.near_settlement
        ? `${hit.near_settlement} ${hit.name_he}`
        : hit.name_he,
    );
    clearHits();
    setPickedStreet(hit);
    void loadStreetAssign(hit.id);

    streetPopupRef.current?.remove();
    streetPopupRef.current = new Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: "260px",
    })
      .setLngLat([hit.lng, hit.lat])
      .setHTML(streetPopupHtml(hit.name_he, hit.ashkol))
      .addTo(map);

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
    const institutionId =
      me?.role === "coordinator"
        ? me.institution_id
        : Number(linkInstitutionId);
    if (!institutionId) {
      setStatus("בחרו מוסד לקישור האשכול");
      return;
    }
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
    setStatus(`אשכול ${picked.ashkol} קושר למוסד`);
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

  type HitItem =
    | { kind: "city"; city: SearchCity }
    | { kind: "street"; street: SearchStreet };
  const hitItems: HitItem[] = [
    ...cityHits.map((city) => ({ kind: "city" as const, city })),
    ...streetHits.map((street) => ({ kind: "street" as const, street })),
  ];
  const showHits = searchOpen && (hitItems.length > 0 || searchBusy || q.trim().length >= 1);
  const canLinkCluster =
    me &&
    (me.role === "super_admin" ||
      me.role === "area_manager" ||
      (me.role === "coordinator" && me.institution_id));

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

  return (
    <div className="street-map-wrap">
      <div className="street-map-toolbar">
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
      <div className="map-side-cards">
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
              {canLinkCluster && (
                <div className="cluster-link-row">
                  {(me?.role === "super_admin" || me?.role === "area_manager") && (
                    <select
                      value={linkInstitutionId}
                      onChange={(e) => setLinkInstitutionId(e.target.value)}
                    >
                      <option value="">מוסד לקישור</option>
                      {institutions.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className="export"
                    onClick={() => void linkClusterToInstitution()}
                  >
                    קשר למוסד
                  </button>
                </div>
              )}
            </>
          ) : (
            <p>לחצו על נקודת אשכול כדי לראות כאן את בז״ב, המצביעים, ההצבעה והימין, לצד הרחובות.</p>
          )}
        </aside>
        <aside className="street-card" aria-live="polite">
          {pickedStreet ? (
            <>
              <h2>{pickedStreet.name_he}</h2>
              {pickedStreet.ashkol ? (
                <div>
                  <span>אשכול</span>
                  <strong><bdi dir="ltr">{pickedStreet.ashkol}</bdi></strong>
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
                        {a.full_name}
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
                    אין רכז מותר לשיוך בעיר הזו (בדקו קבוצה עם יישוב מקושר).
                  </p>
                )}
              </div>
            </>
          ) : (
            <p>לחצו על רחוב לסימון כבוצע, לראות את האשכול כשיקושר, ולהוסיף לרכז.</p>
          )}
        </aside>
      </div>
      <div ref={containerRef} className="street-map-canvas" />
      <p className="map-credit">
        © OpenStreetMap contributors · data available under ODbL · Hebrew names from OSM
      </p>
    </div>
  );
}
