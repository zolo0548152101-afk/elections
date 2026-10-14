/**
 * Match eshkol_streets (loaded from check.csv) to OSM ways in that town
 * and store the links in eshkol_osm_streets. Does not set streets.ashkol.
 *
 * A street listed by several eshkols is linked to each of them.
 */
import { createReadStream } from "fs";
import { createInterface } from "readline";
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

const ADDR_PATH = process.env.ADDR_LL || "/tmp/eshkol-check/addr_ll.jsonl";

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

function pad(b, km) {
  const dLat = km / 111.32;
  const mid = ((b.minLat + b.maxLat) / 2) * Math.PI / 180;
  const dLng = km / (111.32 * Math.cos(mid));
  return {
    minLat: b.minLat - dLat,
    maxLat: b.maxLat + dLat,
    minLng: b.minLng - dLng,
    maxLng: b.maxLng + dLng,
  };
}

function loadAddrBounds() {
  return new Promise((resolveBounds, reject) => {
    const bounds = new Map();
    const rl = createInterface({ input: createReadStream(ADDR_PATH) });
    rl.on("line", (line) => {
      if (!line) return;
      const o = JSON.parse(line);
      let b = bounds.get(o.city);
      if (!b) {
        b = { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 };
        bounds.set(o.city, b);
      }
      b.minLat = Math.min(b.minLat, o.lat);
      b.maxLat = Math.max(b.maxLat, o.lat);
      b.minLng = Math.min(b.minLng, o.lng);
      b.maxLng = Math.max(b.maxLng, o.lng);
    });
    rl.on("close", () => resolveBounds(bounds));
    rl.on("error", reject);
  });
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
  return [];
}

const sql = neon(url);

const bounds = await loadAddrBounds();
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
const osm = await sql`
  SELECT id, name_he, lat, lng
  FROM streets
  WHERE name_he <> ''
`;

const links = [];
let matchedRows = 0;
let missedRows = 0;
const seen = new Set();

const towns = new Map();
for (const row of listed) {
  if (!towns.has(row.settlement_name)) towns.set(row.settlement_name, []);
  towns.get(row.settlement_name).push(row);
}

for (const [settlement, rows] of towns) {
  const addr = bounds.get(settlement);
  const place = bySettlement.get(settlement);
  let box = addr;
  if (!box && place) {
    box = {
      minLat: Number(place.lat) - 0.02,
      maxLat: Number(place.lat) + 0.02,
      minLng: Number(place.lng) - 0.02,
      maxLng: Number(place.lng) + 0.02,
    };
  }
  if (!box) {
    missedRows += rows.length;
    continue;
  }
  const area = pad(box, 1.5);
  const local = new Map();
  for (const street of osm) {
    if (street.lat < area.minLat || street.lat > area.maxLat || street.lng < area.minLng || street.lng > area.maxLng) {
      continue;
    }
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
