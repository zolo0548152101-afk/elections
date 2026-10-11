import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", override: true });
const sql = neon(process.env.DATABASE_URL);
const dir = "data/street_batches";
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

// Replacing the street table also deletes street_marks. Require an explicit flag.
if (process.env.REPLACE_STREETS === "1") {
  await sql`TRUNCATE street_marks, streets`;
}

let n = 0;
for (const file of files) {
  const chunk = JSON.parse(readFileSync(join(dir, file), "utf8"));
  await sql`
    INSERT INTO streets (
      id, name_he, lat, lng, bbox_xmin, bbox_ymin, bbox_xmax, bbox_ymax, geom_geojson, ashkol
    )
    SELECT * FROM UNNEST(
      ${chunk.map((s) => s.id)}::text[],
      ${chunk.map((s) => s.name_he)}::text[],
      ${chunk.map((s) => s.lat)}::float8[],
      ${chunk.map((s) => s.lng)}::float8[],
      ${chunk.map((s) => s.bbox_xmin)}::float8[],
      ${chunk.map((s) => s.bbox_ymin)}::float8[],
      ${chunk.map((s) => s.bbox_xmax)}::float8[],
      ${chunk.map((s) => s.bbox_ymax)}::float8[],
      ${chunk.map((s) => s.geom_geojson)}::text[],
      ${chunk.map((s) => s.ashkol)}::text[]
    )
    ON CONFLICT (id) DO UPDATE SET
      name_he = EXCLUDED.name_he,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      bbox_xmin = EXCLUDED.bbox_xmin,
      bbox_ymin = EXCLUDED.bbox_ymin,
      bbox_xmax = EXCLUDED.bbox_xmax,
      bbox_ymax = EXCLUDED.bbox_ymax,
      geom_geojson = EXCLUDED.geom_geojson
  `;
  n += chunk.length;
  if (n % 2000 === 0 || file === files[files.length - 1]) console.log("streets", n);
}

const [{ count }] = await sql`SELECT count(*)::int AS count FROM streets`;
console.log({ streets: count });
