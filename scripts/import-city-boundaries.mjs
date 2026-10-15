/**
 * Download each eshkol town's municipal outline and store it in city_boundaries.
 * Nominatim allows one request per second. The polygon is the city check for streets.
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

function normCity(s) {
  return String(s || "")
    .replace(/["'׳״`]/g, "")
    .replace(/[־\-–—]/g, "")
    .replace(/\s+/g, "")
    .replaceAll("קריית", "קרית");
}

function variants(name) {
  const out = [name];
  const add = (value) => {
    if (value && !out.includes(value)) out.push(value);
  };
  if (name.includes("קרית")) add(name.replaceAll("קרית", "קריית"));
  if (name.includes("קריית")) add(name.replaceAll("קריית", "קרית"));
  if (normCity(name) === normCity("תל אביב  יפו")) {
    add("תל אביב-יפו");
    add("תל אביב יפו");
  }
  if (normCity(name) === "מעלותתרשיחא") {
    add("מעלות-תרשיחא");
    add("מעלות תרשיחא");
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function search(name) {
  const endpoint = new URL("https://nominatim.openstreetmap.org/search");
  endpoint.searchParams.set("city", name);
  endpoint.searchParams.set("country", "Israel");
  endpoint.searchParams.set("featuretype", "settlement");
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("polygon_geojson", "1");
  endpoint.searchParams.set("limit", "5");
  const res = await fetch(endpoint, {
    headers: { "user-agent": "election-day-ops/city-boundaries" },
  });
  if (!res.ok) throw new Error(`nominatim ${res.status} for ${name}`);
  return res.json();
}

function usable(hit, wanted) {
  const geom = hit.geojson;
  if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) return false;
  if (hit.category !== "boundary" && hit.category !== "place") return false;
  const got = normCity(hit.name || "");
  return got === normCity(wanted) || variants(wanted).some((name) => normCity(name) === got);
}

function rank(hit) {
  let score = 0;
  if (hit.osm_type === "relation") score += 4;
  if (hit.addresstype === "municipality" || hit.type === "administrative") score += 3;
  if (hit.category === "boundary") score += 2;
  return score;
}

const sql = neon(url);
await sql`
  CREATE TABLE IF NOT EXISTS city_boundaries (
    settlement_name text PRIMARY KEY,
    osm_name text NOT NULL,
    geom_geojson text NOT NULL
  )
`;

const towns = await sql`SELECT DISTINCT settlement_name FROM eshkol_streets ORDER BY 1`;
const saved = [];
const missed = [];

for (const town of towns) {
  let chosen = null;
  for (const name of variants(town.settlement_name)) {
    const hits = (await search(name)).filter((hit) => usable(hit, town.settlement_name));
    hits.sort((a, b) => rank(b) - rank(a));
    if (hits[0]) {
      chosen = hits[0];
      break;
    }
    await sleep(1100);
  }
  if (!chosen) {
    missed.push(town.settlement_name);
    await sleep(1100);
    continue;
  }
  await sql`
    INSERT INTO city_boundaries (settlement_name, osm_name, geom_geojson)
    VALUES (${town.settlement_name}, ${chosen.name}, ${JSON.stringify(chosen.geojson)})
    ON CONFLICT (settlement_name) DO UPDATE
      SET osm_name = EXCLUDED.osm_name,
          geom_geojson = EXCLUDED.geom_geojson
  `;
  saved.push(`${town.settlement_name} ← ${chosen.name} (${chosen.geojson.type})`);
  await sleep(1100);
}

console.log(saved.join("\n"));
console.log({ saved: saved.length, missed });
