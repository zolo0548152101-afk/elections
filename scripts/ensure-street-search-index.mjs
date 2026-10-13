/**
 * Add the Hebrew street-name trigram index. Does not modify street rows.
 * Usage: node scripts/ensure-street-search-index.mjs
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", override: true });
const url = process.env.DATABASE_URL;
if (!url || !url.startsWith("postgres")) {
  console.error("DATABASE_URL is missing or invalid");
  process.exit(1);
}

const sql = neon(url);
await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
await sql`CREATE INDEX IF NOT EXISTS streets_name_he_trgm_idx ON streets USING gin (name_he gin_trgm_ops)`;
await sql`
  CREATE INDEX IF NOT EXISTS streets_name_he_clean_trgm_idx
  ON streets USING gin ((regexp_replace(name_he, '[''׳״"]+', '', 'g')) gin_trgm_ops)
`;
const rows = await sql`
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'streets'
    AND indexname IN ('streets_name_he_trgm_idx', 'streets_name_he_clean_trgm_idx')
  ORDER BY indexname
`;
console.log({ indexes: rows.map((row) => row.indexname) });
