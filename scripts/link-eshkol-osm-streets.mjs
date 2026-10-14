/**
 * Match eshkol_streets (loaded from check.csv) to OSM ways inside that
 * city's municipal outline and store the links in eshkol_osm_streets.
 * Does not set streets.ashkol.
 *
 * A street listed by several eshkols is linked to each of them.
 */
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local"), override: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

function normStreet(s) {
  let out = String(s || "").trim();
  out = out.replace(/["'׳״`]/g, "");
  out = out.replace(/[־\-–—]/g, " ").replace(/[()]/g, " ");
  out = out.replace(/\s+/g, " ").trim();
  out = out.replaceAll("קיבוץ", "קבוץ");
  out = out.replace(/[ךםןףץ]/g, (ch) => "כמנפצ"["ךםןףץ".indexOf(ch)]);
  if (out.startsWith("רחוב ")) out = out.slice(5).trim();
  return out;
}

function streetKeys(s) {
  const base = normStreet(s);
  const keys = [];
  const add = (k) => {
    const cleaned = k.replace(/\s+/g, " ").trim();
    if (cleaned && !keys.includes(cleaned)) keys.push(cleaned);
  };
  add(base);
  if (base.startsWith("ש ") && !base.startsWith("שד ")) {
    const rest = base.slice(2).trim();
    add(`שדרות ${rest}`);
    add(`שד ${rest}`);
    add(rest);
  }
  const replacements = [
    ["שדרות ", "שד "],
    ["שד ", "שדרות "],
    ["שכון ", "שיכון "],
    ["שיכון ", "שכון "],
    ["שכונת ", "שכ "],
    ["שכ ", "שכונת "],
    ["סמטת ", "סמ "],
    ["סמ ", "סמטת "],
  ];
  for (const [a, b] of replacements) {
    if (base.startsWith(a)) add(b + base.slice(a.length));
  }
  for (const pref of [
    "שדרות ", "שד ", "סמטת ", "סמטה ", "סמ ", "משעול ",
    "שכונת ", "שכונה ", "שכ ", "דרך ", "שכון ", "שיכון ", "כביש ", "הרב ",
  ]) {
    if (base.startsWith(pref)) add(base.slice(pref.length).trim());
  }
  return keys;
}

function isSwap(base, key) {
  const pairs = [
    ["שדרות ", "שד "],
    ["שד ", "שדרות "],
    ["שכון ", "שיכון "],
    ["שיכון ", "שכון "],
    ["שכונת ", "שכ "],
    ["שכ ", "שכונת "],
    ["סמטת ", "סמ "],
    ["סמ ", "סמטת "],
  ];
  for (const [a, b] of pairs) {
    if (base.startsWith(a) && key === b + base.slice(a.length)) return true;
    if (base.startsWith("ש ") && (key === `שדרות ${base.slice(2).trim()}` || key === `שד ${base.slice(2).trim()}`)) {
      return true;
    }
  }
  return false;
}

function ringContains(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses = (yi > lat) !== (yj > lat)
      && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonContains(polygon, lng, lat) {
  if (!ringContains(polygon[0], lng, lat)) return false;
  for (let hole = 1; hole < polygon.length; hole++) {
    if (ringContains(polygon[hole], lng, lat)) return false;
  }
  return true;
}

function geomContains(geom, lng, lat) {
  if (geom.type === "Polygon") return polygonContains(geom.coordinates, lng, lat);
  if (geom.type === "MultiPolygon") {
    return geom.coordinates.some((polygon) => polygonContains(polygon, lng, lat));
  }
  return false;
}

function boundsOf(geom) {
  let minLng = 180;
  let maxLng = -180;
  let minLat = 90;
  let maxLat = -90;
  const walk = (node) => {
    if (typeof node[0] === "number") {
      minLng = Math.min(minLng, node[0]);
      maxLng = Math.max(maxLng, node[0]);
      minLat = Math.min(minLat, node[1]);
      maxLat = Math.max(maxLat, node[1]);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(geom.coordinates);
  return { minLng, maxLng, minLat, maxLat, area: (maxLng - minLng) * (maxLat - minLat) };
}

function matchName(csvName, localNames) {
  const keys = streetKeys(csvName);
  const base = keys[0];
  if (!base || base.length < 2 || base.includes("ללא רחוב")) return [];
  if (localNames.has(base)) return [base];
  const swaps = keys.filter((key) => key !== base && isSwap(base, key) && localNames.has(key));
  if (swaps.length > 0) return [...new Set(swaps)];
  const strips = keys.filter((key) => key !== base && !isSwap(base, key) && localNames.has(key));
  if (strips.length === 1) return strips;
  const compact = base.replace(/\s+/g, "");
  const spaced = [...localNames].filter((name) => name.replace(/\s+/g, "") === compact);
  if (spaced.length === 1) return spaced;
  if (base.includes(" ") || base.length >= 6) {
    const endings = [...new Set([...localNames].filter((name) => name.endsWith(` ${base}`)))];
    if (endings.length === 1) return endings;
  }
  return [];
}

const sql = neon(url);

await sql`
  CREATE TABLE IF NOT EXISTS eshkol_osm_streets (
    ashkol text NOT NULL REFERENCES clusters(ashkol) ON DELETE CASCADE,
    street_name text NOT NULL,
    street_id text NOT NULL REFERENCES streets(id) ON DELETE CASCADE,
    PRIMARY KEY (ashkol, street_name, street_id)
  )
`;

const listed = await sql`
  SELECT ashkol, settlement_name, street_name
  FROM eshkol_streets
`;
const boundaryRows = await sql`SELECT settlement_name, geom_geojson FROM city_boundaries`;
const boundaries = boundaryRows.map((row) => {
  const geom = JSON.parse(row.geom_geojson);
  return { settlement_name: row.settlement_name, geom, ...boundsOf(geom) };
});
const osm = await sql`
  SELECT id, name_he, lat, lng
  FROM streets
  WHERE name_he <> ''
`;
const streetsByCity = new Map();
for (const street of osm) {
  const hits = boundaries.filter((boundary) => (
    street.lng >= boundary.minLng && street.lng <= boundary.maxLng
    && street.lat >= boundary.minLat && street.lat <= boundary.maxLat
    && geomContains(boundary.geom, street.lng, street.lat)
  ));
  if (hits.length === 0) continue;
  hits.sort((a, b) => a.area - b.area);
  const city = hits[0].settlement_name;
  if (!streetsByCity.has(city)) streetsByCity.set(city, new Map());
  const named = streetsByCity.get(city);
  const name = normStreet(street.name_he);
  if (!name) continue;
  if (!named.has(name)) named.set(name, []);
  named.get(name).push(street.id);
}

const links = [];
let matchedRows = 0;
let missedRows = 0;
const seen = new Set();

const byAshkol = new Map();
for (const row of listed) {
  if (!byAshkol.has(row.ashkol)) byAshkol.set(row.ashkol, []);
  byAshkol.get(row.ashkol).push(row);
}

for (const [, rows] of byAshkol) {
  const local = streetsByCity.get(rows[0].settlement_name);
  if (!local) {
    missedRows += rows.length;
    continue;
  }
  const names = new Set(local.keys());
  for (const row of rows) {
    const hits = matchName(row.street_name, names);
    if (hits.length === 0) {
      missedRows += 1;
      continue;
    }
    matchedRows += 1;
    for (const hit of hits) {
      for (const id of local.get(hit)) {
        const key = `${row.ashkol}\0${row.street_name}\0${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ ashkol: row.ashkol, street_name: row.street_name, street_id: id });
      }
    }
  }
}

await sql`TRUNCATE eshkol_osm_streets`;
const size = 400;
for (let i = 0; i < links.length; i += size) {
  const chunk = links.slice(i, i + size);
  await sql`
    INSERT INTO eshkol_osm_streets (ashkol, street_name, street_id)
    SELECT * FROM unnest(
      ${chunk.map((row) => row.ashkol)}::text[],
      ${chunk.map((row) => row.street_name)}::text[],
      ${chunk.map((row) => row.street_id)}::text[]
    )
  `;
}

console.log({
  listed: listed.length,
  matchedRows,
  missedRows,
  pct: Math.round((1000 * matchedRows) / listed.length) / 10,
  osmLinks: links.length,
});
