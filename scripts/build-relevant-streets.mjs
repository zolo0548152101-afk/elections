/**
 * Index of workbook rows that have a map location.
 * Lines are street ids already in `streets`. Points are places with
 * coordinates but no street line. The map API joins the line geometry.
 *
 * Usage: node scripts/build-relevant-streets.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wb = XLSX.read(readFileSync(resolve(root, "data/osm-street-match.xlsx")));
const rows = XLSX.utils.sheet_to_json(wb.Sheets.matched, { header: 1, defval: "" });
const header = rows[0];
const col = Object.fromEntries(header.map((name, i) => [name, i]));

function cell(row, name) {
  return row[col[name]];
}

const byStreet = new Map();
const byPoint = new Map();

for (const row of rows.slice(1)) {
  const city = String(cell(row, "עיר") ?? "").trim();
  const ashkol = String(cell(row, "אשכול") ?? "").trim();
  const street = String(cell(row, "רחוב") ?? "").trim();
  const mapName = String(cell(row, "map_name") ?? "").trim();
  const id = String(cell(row, "street_id") ?? "").trim();
  const lat = Number(cell(row, "lat"));
  const lng = Number(cell(row, "lng"));
  if (!ashkol || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

  if (id) {
    const prev = byStreet.get(id) ?? {
      id,
      name: mapName || street,
      city,
      ashkols: [],
    };
    prev.ashkols.push(ashkol);
    if (!prev.name && mapName) prev.name = mapName;
    byStreet.set(id, prev);
    continue;
  }

  const key = `${city}\0${mapName || street}\0${lat.toFixed(4)}\0${lng.toFixed(4)}`;
  const prev = byPoint.get(key) ?? {
    name: mapName || street,
    city,
    lat,
    lng,
    ashkols: [],
  };
  prev.ashkols.push(ashkol);
  byPoint.set(key, prev);
}

function primary(ashkols) {
  const counts = new Map();
  for (const ashkol of ashkols) counts.set(ashkol, (counts.get(ashkol) ?? 0) + 1);
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en", { numeric: true }),
  )[0][0];
}

function pack(entry) {
  const ashkols = [...new Set(entry.ashkols)];
  return {
    ...entry,
    ashkol: primary(entry.ashkols),
    ashkols,
  };
}

const out = {
  streets: [...byStreet.values()].map(pack),
  points: [...byPoint.values()].map(pack),
};
const path = resolve(root, "data/relevant-streets.json");
writeFileSync(path, JSON.stringify(out));
console.log({ streets: out.streets.length, points: out.points.length, path });
