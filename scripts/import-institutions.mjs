/**
 * Import data/institutions-workbook.xlsx into institutions + institution_contacts.
 * Upserts by name. Does not delete existing institutions (keeps מערכת).
 *
 * Usage: node scripts/import-institutions.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { neon } from "@neondatabase/serverless";
import XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const KINDS = new Set([
  "ישיבת הסדר",
  "ישיבה תיכונית",
  "גרעין",
  "מדרשה",
  "אולפנה",
  "מוסד חינוך",
]);

const sql = neon(url);
const xlsxPath = resolve(__dirname, "../data/institutions-workbook.xlsx");
const wb = XLSX.read(readFileSync(xlsxPath));
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false });

function normalizeSettlement(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .replace(/-/g, " ")
    .trim();
}

function parseContacts(raw) {
  if (!raw) return [];
  return String(raw)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, sort_order) => {
      const phoneMatch = part.match(/(\d{2,3}[-\s]?\d{7}|\d{9,10})\s*$/);
      const phone = phoneMatch ? phoneMatch[1].replace(/\s+/g, "-") : "";
      let rest = phoneMatch ? part.slice(0, phoneMatch.index).trim() : part;
      const roleMatch = rest.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      if (roleMatch) {
        return {
          full_name: roleMatch[1].trim(),
          role_title: roleMatch[2].trim(),
          phone,
          sort_order,
        };
      }
      return { full_name: rest, role_title: "", phone, sort_order };
    })
    .filter((c) => c.full_name);
}

const settlements = await sql`SELECT name_he FROM settlements`;
const settlementIndex = new Map(
  settlements.map((s) => [normalizeSettlement(s.name_he), s.name_he]),
);

function matchSettlement(raw) {
  if (!raw) return null;
  const n = normalizeSettlement(raw);
  if (settlementIndex.has(n)) return settlementIndex.get(n);
  // loose contains
  for (const [key, name] of settlementIndex) {
    if (key.includes(n) || n.includes(key)) return name;
  }
  return null;
}

let upserted = 0;
let contacts = 0;
let unmatchedCity = 0;

for (const row of rows) {
  const name = String(row["שם"] || "").trim();
  if (!name || name === "מערכת") continue;
  const kind = String(row["סוג"] || "").trim();
  if (kind && !KINDS.has(kind)) {
    console.warn("unknown kind", kind, "for", name);
  }
  const cityRaw = row["יישוב"] ? String(row["יישוב"]).trim() : "";
  const matched = matchSettlement(cityRaw);
  if (cityRaw && !matched) unmatchedCity += 1;
  const settlement_name = matched || cityRaw || null;
  const district = row["מחוז"] ? String(row["מחוז"]).trim() : null;
  const lat = row["קו רוחב"] != null && row["קו רוחב"] !== "" ? Number(row["קו רוחב"]) : null;
  const lng = row["קו אורך"] != null && row["קו אורך"] !== "" ? Number(row["קו אורך"]) : null;
  const key_people_raw = row["אנשי מפתח"]
    ? String(row["אנשי מפתח"]).trim()
    : null;

  const [inst] = await sql`
    INSERT INTO institutions (name, kind, settlement_name, district, lat, lng, key_people_raw)
    VALUES (
      ${name},
      ${kind || null},
      ${settlement_name},
      ${district},
      ${Number.isFinite(lat) ? lat : null},
      ${Number.isFinite(lng) ? lng : null},
      ${key_people_raw}
    )
    ON CONFLICT (name) DO UPDATE SET
      kind = EXCLUDED.kind,
      settlement_name = EXCLUDED.settlement_name,
      district = EXCLUDED.district,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      key_people_raw = EXCLUDED.key_people_raw
    RETURNING id
  `;
  upserted += 1;

  await sql`DELETE FROM institution_contacts WHERE institution_id = ${inst.id}`;
  const people = parseContacts(key_people_raw);
  for (const p of people) {
    await sql`
      INSERT INTO institution_contacts (institution_id, full_name, role_title, phone, sort_order)
      VALUES (${inst.id}, ${p.full_name}, ${p.role_title}, ${p.phone}, ${p.sort_order})
    `;
    contacts += 1;
  }
}

console.log({
  rows: rows.length,
  upserted,
  contacts,
  unmatchedCity,
});
