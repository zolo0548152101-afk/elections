/**
 * Match eshkol_streets (loaded from check.csv) to OSM ways in that town
 * and store the links in eshkol_osm_streets. Does not set streets.ashkol.
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

function havKm(a, b) {
  const r = 6371;
  const p1 = (a[0] * Math.PI) / 180;
  const p2 = (b[0] * Math.PI) / 180;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Streets are kept near this eshkol's own houses, not the whole country. */
function areaFor(points, fallback) {
  const src = points.length > 0 ? points : fallback ? [fallback] : [];
  if (src.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const point of src) {
    lat += Number(point.lat);
    lng += Number(point.lng);
  }
  lat /= src.length;
  lng /= src.length;
  if (points.length === 0) return { lat, lng, radius: 4 };
  const distances = points.map((point) => havKm([lat, lng], [Number(point.lat), Number(point.lng)])).sort((a, b) => a - b);
  const typical = distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.9))];
  return { lat, lng, radius: Math.min(7, Math.max(3.5, typical + 2)) };
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
const settlements = await sql`SELECT name_he, lat, lng FROM settlements`;
const bySettlement = new Map(settlements.map((row) => [row.name_he, row]));
const houseRows = await sql`SELECT ashkol, lat, lng FROM eshkol_houses`;
const housesByAshkol = new Map();
for (const house of houseRows) {
  if (!housesByAshkol.has(house.ashkol)) housesByAshkol.set(house.ashkol, []);
  housesByAshkol.get(house.ashkol).push(house);
}
const osm = await sql`
  SELECT id, name_he, lat, lng
  FROM streets
  WHERE name_he <> ''
`;

const links = [];
let matchedRows = 0;
let missedRows = 0;
const seen = new Set();

const byAshkol = new Map();
for (const row of listed) {
  if (!byAshkol.has(row.ashkol)) byAshkol.set(row.ashkol, []);
  byAshkol.get(row.ashkol).push(row);
}

for (const [ashkol, rows] of byAshkol) {
  const place = bySettlement.get(rows[0].settlement_name);
  const area = areaFor(housesByAshkol.get(ashkol) ?? [], place);
  if (!area) {
    missedRows += rows.length;
    continue;
  }
  const local = new Map();
  for (const street of osm) {
    if (havKm([area.lat, area.lng], [street.lat, street.lng]) > area.radius) continue;
    const name = normStreet(street.name_he);
    if (!name) continue;
    if (!local.has(name)) local.set(name, []);
    local.get(name).push(street.id);
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
