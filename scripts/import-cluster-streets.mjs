/**
 * Later: import a CSV/JSON linking streets to ashkol clusters.
 * Expected JSON rows: { street_id?: string, name_he?: string, ashkol: string, lat?: number, lng?: number }
 * Matches by street_id, or by nearest same-name street to lat/lng.
 *
 * Usage: node scripts/import-cluster-streets.mjs path/to/links.json
 */
import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", override: true });
const sql = neon(process.env.DATABASE_URL);
const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/import-cluster-streets.mjs links.json");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(file, "utf8"));
let updated = 0;
for (const row of rows) {
  if (row.street_id && row.ashkol) {
    const r = await sql`
      UPDATE streets SET ashkol = ${String(row.ashkol)}
      WHERE id = ${String(row.street_id)}
      RETURNING id
    `;
    updated += r.length;
    continue;
  }
  if (row.name_he && row.ashkol && row.lat != null && row.lng != null) {
    const r = await sql`
      UPDATE streets SET ashkol = ${String(row.ashkol)}
      WHERE id = (
        SELECT id FROM streets
        WHERE name_he = ${String(row.name_he)}
        ORDER BY (lat - ${Number(row.lat)})^2 + (lng - ${Number(row.lng)})^2
        LIMIT 1
      )
      RETURNING id
    `;
    updated += r.length;
  }
}
const [{ linked }] = await sql`SELECT count(*)::int AS linked FROM streets WHERE ashkol IS NOT NULL`;
console.log({ updated, linked });
