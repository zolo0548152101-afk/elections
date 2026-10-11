/**
 * Apply scripts/schema.sql to DATABASE_URL (idempotent, no truncates).
 * Usage: node scripts/apply-schema.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { neon } from "@neondatabase/serverless";

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sqlText = readFileSync(resolve(__dirname, "schema.sql"), "utf8");
const sql = neon(url);

// neon() runs one statement per call; split on semicolons outside dollar quotes is enough for this file.
const statements = sqlText
  .split(/;\s*\n/)
  .map((s) =>
    s
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim(),
  )
  .filter((s) => s.length > 0);

for (const statement of statements) {
  await sql.query(statement);
  console.log("ok:", statement.slice(0, 60).replace(/\s+/g, " "));
}

console.log("schema applied");
