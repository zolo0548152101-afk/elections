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

/** Split SQL into statements, keeping DO $$ ... $$; blocks intact. */
function splitStatements(text) {
  const withoutLineComments = text
    .split("\n")
    .map((line) => (line.trim().startsWith("--") ? "" : line))
    .join("\n");

  const statements = [];
  let buf = "";
  let inDollar = false;
  for (let i = 0; i < withoutLineComments.length; i++) {
    const ch = withoutLineComments[i];
    const next2 = withoutLineComments.slice(i, i + 2);
    if (next2 === "$$") {
      inDollar = !inDollar;
      buf += "$$";
      i += 1;
      continue;
    }
    if (ch === ";" && !inDollar) {
      const stmt = buf.trim();
      if (stmt) statements.push(stmt);
      buf = "";
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) statements.push(tail);
  return statements;
}

const statements = splitStatements(sqlText);
for (const statement of statements) {
  await sql.query(statement);
  console.log("ok:", statement.slice(0, 70).replace(/\s+/g, " "));
}

console.log("schema applied");
