/**
 * Standalone map of the matched workbook streets. Not part of the app.
 *
 * Usage: node scripts/build-street-map.mjs
 * Opens: maps/cluster-streets.html
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { neon } from "@neondatabase/serverless";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(resolve(root, "data/relevant-streets.json"), "utf8"));

const COLORS = [
  "#c23b3b",
  "#1f7a4d",
  "#2c5aa0",
  "#c48a1a",
  "#6b4c9a",
  "#0f766e",
  "#b45309",
  "#be185d",
  "#1d4ed8",
  "#4d7c0f",
  "#7c3aed",
  "#0e7490",
];

function colorMap(ashkols) {
  const sorted = [...new Set(ashkols)].sort((a, b) =>
    a.localeCompare(b, "en", { numeric: true }),
  );
  return new Map(sorted.map((ashkol, i) => [ashkol, COLORS[i % COLORS.length]]));
}

const byCity = new Map();
for (const row of [...index.streets, ...index.points]) {
  const list = byCity.get(row.city) ?? [];
  list.push(...row.ashkols);
  byCity.set(row.city, list);
}
const colors = new Map();
for (const [city, ashkols] of byCity) {
  for (const [ashkol, color] of colorMap(ashkols)) {
    colors.set(`${city}\0${ashkol}`, color);
  }
}

const sql = neon(process.env.DATABASE_URL);
const ids = index.streets.map((row) => row.id);
const geoms = await sql`
  SELECT id, geom_geojson
  FROM streets
  WHERE id = ANY(${ids})
`;
const geomById = new Map(geoms.map((row) => [row.id, JSON.parse(row.geom_geojson)]));

const features = [];
for (const row of index.streets) {
  const geometry = geomById.get(row.id);
  if (!geometry) continue;
  features.push({
    type: "Feature",
    properties: {
      name: row.name,
      city: row.city,
      ashkol: row.ashkol,
      ashkols: row.ashkols.join(", "),
      color: colors.get(`${row.city}\0${row.ashkol}`) ?? "#334155",
    },
    geometry,
  });
}
for (const row of index.points) {
  features.push({
    type: "Feature",
    properties: {
      name: row.name,
      city: row.city,
      ashkol: row.ashkol,
      ashkols: row.ashkols.join(", "),
      color: colors.get(`${row.city}\0${row.ashkol}`) ?? "#334155",
      point: true,
    },
    geometry: { type: "Point", coordinates: [row.lng, row.lat] },
  });
}

const cities = [...byCity.keys()].sort((a, b) => a.localeCompare(b, "he"));
const cityCounts = Object.fromEntries(
  cities.map((city) => [city, features.filter((f) => f.properties.city === city).length]),
);

const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>רחובות האשכולות</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body { margin: 0; height: 100%; font-family: "Segoe UI", Arial, sans-serif; }
    #map { position: absolute; inset: 0; }
    #side {
      position: absolute; top: 12px; right: 12px; z-index: 500;
      width: 240px; max-height: calc(100% - 24px); overflow: auto;
      background: #fff; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.18);
      padding: 12px 14px;
    }
    h1 { font-size: 16px; margin: 0 0 4px; }
    p { margin: 0 0 10px; color: #475569; font-size: 12px; line-height: 1.4; }
    button {
      display: flex; justify-content: space-between; width: 100%;
      margin: 0 0 4px; padding: 6px 8px; border: 0; border-radius: 8px;
      background: #f8fafc; cursor: pointer; font: inherit; text-align: right;
    }
    button:hover, button.active { background: #e0e7ff; }
    .count { color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <aside id="side">
    <h1>רחובות האשכולות</h1>
    <p>מפה נפרדת. כל צבע הוא אשכול בתוך העיר. נקודה = יש קואורדינטה בלי קו רחוב.</p>
    <div id="cities"></div>
  </aside>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const FEATURES = ${JSON.stringify({ type: "FeatureCollection", features })};
    const COUNTS = ${JSON.stringify(cityCounts)};
    const map = L.map("map", { zoomControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);

    const layersByCity = new Map();
    const all = L.geoJSON(FEATURES, {
      style: (f) => ({ color: f.properties.color, weight: 4, opacity: 0.9 }),
      pointToLayer: (f, latlng) => L.circleMarker(latlng, {
        radius: 6,
        color: "#fff",
        weight: 1,
        fillColor: f.properties.color,
        fillOpacity: 0.95,
      }),
      onEachFeature: (f, layer) => {
        const p = f.properties;
        const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
        layer.bindPopup(
          "<div dir='rtl'><b>" + esc(p.name) + "</b><br>" + esc(p.city) +
          "<br>אשכול " + esc(p.ashkols) + (p.point ? "<br>נקודה, בלי קו" : "") + "</div>"
        );
        const list = layersByCity.get(p.city) || [];
        list.push(layer);
        layersByCity.set(p.city, list);
      },
    }).addTo(map);
    map.fitBounds(all.getBounds(), { padding: [24, 24] });

    const box = document.getElementById("cities");
    let active = null;
    for (const city of Object.keys(COUNTS).sort((a, b) => a.localeCompare(b, "he"))) {
      const btn = document.createElement("button");
      btn.innerHTML = "<span>" + city + "</span><span class='count'>" + COUNTS[city] + "</span>";
      btn.onclick = () => {
        if (active) active.classList.remove("active");
        btn.classList.add("active");
        active = btn;
        const group = L.featureGroup(layersByCity.get(city) || []);
        if (group.getLayers().length) map.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 15 });
      };
      box.appendChild(btn);
    }
  </script>
</body>
</html>
`;

const out = resolve(root, "maps/cluster-streets.html");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log({
  features: features.length,
  lines: features.filter((f) => f.geometry.type !== "Point").length,
  points: features.filter((f) => f.geometry.type === "Point").length,
  bytes: Buffer.byteLength(html),
  out,
});
