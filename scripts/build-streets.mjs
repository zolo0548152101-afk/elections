/**
 * Rebuild named Hebrew street lines from HOT OSM Israel roads GeoParquet.
 * Requires: python3 + duckdb, and /tmp/isr_roads.parquet (or set ROADS_PARQUET).
 * Then run: node scripts/seed-streets.mjs
 *
 * Download:
 *   curl -L -o /tmp/isr_roads.parquet \
 *     https://production-raw-data-api.s3.amazonaws.com/ISO3/ISR/_layers/osm/roads.parquet
 */
import { spawnSync } from "child_process";

const py = spawnSync("python3", ["scripts/merge_streets.py"], {
  stdio: "inherit",
  env: process.env,
});
process.exit(py.status ?? 1);
