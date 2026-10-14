/**
 * Load check.csv house lists and geocoded points into eshkol_streets / eshkol_houses.
 * Does not set streets.ashkol. Replaces only these two tables.
 *
 * Usage:
 *   node scripts/import-eshkol-houses.mjs --workbook /path/to/addresses.xlsx
 *   node scripts/import-eshkol-houses.mjs --points /path/to/addr_ll.jsonl
 *
 * --points is the workbook already converted to WGS84 lines:
 *   {"city","street","num","lat","lng"}
 */
import { createReadStream, readFileSync } from "fs";
import { createInterface } from "readline";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import XLSX from "xlsx";
import proj4 from "proj4";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env.local"), override: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const CSV_PATH = resolve(__dirname, "../check.csv");
const TOKEN = /^(\d+)/;
const HEB_ONLY = /^[\u0590-\u05FF]+$/;

const CITIES = [
  "אופקים", "ירושלים", "תל אביב  יפו", "באר שבע", "נתניה", "דימונה", "צפת",
  "טבריה", "אשקלון", "שדרות", "עפולה", "טירת כרמל", "אילת", "לוד", "פתח תקווה",
  "ראשון לציון", "נהריה", "קרית ים", "נתיבות", "בת ים", "כפר סבא", "רחובות",
  "קרית ארבע", "אשדוד", "מעלה אדומים", "רמלה", "קרית שמונה", "אור עקיבא",
  "גבעת שמואל", "עכו", "מגדל העמק", "מעלה אפרים", "מעלותתרשיחא", "קרית גת",
  'כפר חב"ד', "קרית אתא", "באר יעקב", "בית שמש", "יפית",
];

proj4.defs(
  "ITM",
  "+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.390 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
);

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : "";
}

function normCity(s) {
  return String(s || "")
    .replace(/["'׳״`]/g, "")
    .replace(/[-־–]/g, " ")
    .replace(/\s+/g, "")
    .replaceAll("קריית", "קרית")
    .replaceAll("נהרייה", "נהריה");
}

const CITY_KEYS = new Map(CITIES.map((city) => [normCity(city), city]));

function normStreet(s) {
  let out = String(s || "").trim();
  out = out.replace(/["'׳״`]/g, "");
  out = out.replace(/[־\-–—]/g, " ").replace(/[()]/g, " ");
  out = out.replace(/\s+/g, " ").trim();
  out = out.replace(/[ךםןףץ]/g, (ch) => "כמנפצ"["ךםןףץ".indexOf(ch)]);
  if (out.startsWith("רחוב ")) out = out.slice(5).trim();
  return out.replaceAll("קיבוץ", "קבוץ");
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
    "שכונת ", "שכונה ", "שכ ", "דרך ", "שכון ", "שיכון ", "כביש ",
  ]) {
    if (base.startsWith(pref)) add(base.slice(pref.length).trim());
  }
  return keys;
}

function hav(a, b) {
  const r = 6371000;
  const p1 = (a[0] * Math.PI) / 180;
  const p2 = (b[0] * Math.PI) / 180;
  const dphi = ((b[0] - a[0]) * Math.PI) / 180;
  const dl = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function centroid(pts) {
  let lat = 0;
  let lng = 0;
  for (const p of pts) {
    lat += p[0];
    lng += p[1];
  }
  return [lat / pts.length, lng / pts.length];
}

function clusterPoints(pts, eps) {
  const n = pts.length;
  if (n === 0) return [];
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const buckets = new Map();
  const xy = pts.map(([lat, lng]) => {
    const cos = Math.cos((lat * Math.PI) / 180);
    return [lng * 111320 * cos, lat * 110540];
  });
  xy.forEach(([x, y], i) => {
    const key = `${Math.floor(x / eps)}:${Math.floor(y / eps)}`;
    const list = buckets.get(key);
    if (list) list.push(i);
    else buckets.set(key, [i]);
  });
  for (let i = 0; i < n; i++) {
    const [x, y] = xy[i];
    const cx = Math.floor(x / eps);
    const cy = Math.floor(y / eps);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of buckets.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (j <= i) continue;
          if (hav(pts[i], pts[j]) <= eps) union(i, j);
        }
      }
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  }
  return [...groups.values()];
}

function dedupeNumber(points) {
  if (!points?.length) return null;
  const groups = clusterPoints(points, 250).sort((a, b) => b.length - a.length);
  if (groups.length >= 2 && groups[1].length >= 1) {
    const c1 = centroid(groups[0].map((i) => points[i]));
    const c2 = centroid(groups[1].map((i) => points[i]));
    if (hav(c1, c2) > 400) return "ambiguous";
  }
  return centroid(groups[0].map((i) => points[i]));
}

function parseRowNumbers(raw) {
  const seen = new Set();
  const uniq = [];
  for (const part of String(raw || "").split(",")) {
    const t = part.trim();
    if (!t || HEB_ONLY.test(t)) continue;
    const m = TOKEN.exec(t);
    if (!m) continue;
    const n = Number(m[1]);
    if (seen.has(n)) continue;
    seen.add(n);
    uniq.push(n);
  }
  return uniq;
}

function parseCount(raw) {
  const n = Number(String(raw ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function farLimit(settlement) {
  const n = String(settlement || "").replace(/\s+/g, "");
  if (n.includes("ירושלים") || n.includes("תלאביב") || n.includes("בארשבע")) return 18000;
  return 12000;
}

function parseTsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === "\t") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function indexPoint(idx, owners, city, street, num, lat, lng) {
  const keys = streetKeys(street);
  if (keys.length === 0 || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const primary = keys[0];
  const streetKey = `${city}\0${primary}`;
  let byNum = idx.get(streetKey);
  if (!byNum) {
    byNum = new Map();
    idx.set(streetKey, byNum);
  }
  const pts = byNum.get(num);
  if (pts) pts.push([lat, lng]);
  else byNum.set(num, [[lat, lng]]);
  for (const key of keys.slice(1)) {
    const aliasKey = `${city}\0${key}`;
    let set = owners.get(aliasKey);
    if (!set) {
      set = new Set();
      owners.set(aliasKey, set);
    }
    set.add(primary);
  }
}

function lookup(idx, alias, city, street) {
  for (const key of streetKeys(street)) {
    const direct = idx.get(`${city}\0${key}`);
    if (direct) return direct;
    const owner = alias.get(`${city}\0${key}`);
    if (!owner) continue;
    const hit = idx.get(`${city}\0${owner}`);
    if (hit) return hit;
  }
  return null;
}

async function loadPoints(idx, owners) {
  const pointsPath = argValue("--points");
  const workbookPath = argValue("--workbook");
  if (!pointsPath && !workbookPath) {
    console.error("Pass --workbook addresses.xlsx or --points addr_ll.jsonl");
    process.exit(1);
  }
  if (pointsPath) {
    const rl = createInterface({ input: createReadStream(pointsPath, "utf8"), crlfDelay: Infinity });
    let n = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      indexPoint(idx, owners, r.city, r.street, Number(r.num), Number(r.lat), Number(r.lng));
      n += 1;
    }
    console.log("indexed jsonl points", n);
    return;
  }
  console.log("reading workbook", workbookPath);
  const wb = XLSX.read(readFileSync(workbookPath));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: "A", raw: true, defval: "" });
  let n = 0;
  for (const row of rows) {
    const city = CITY_KEYS.get(normCity(row.A));
    if (!city) continue;
    const m = TOKEN.exec(String(row.C ?? "").trim());
    if (!m) continue;
    const num = Number(m[1]);
    if (num <= 0 || num > 9999) continue;
    const x = Number(row.F);
    const y = Number(row.G);
    if (!(x > 1000) || !(y > 1000)) continue;
    const [lng, lat] = proj4("ITM", "WGS84", [x, y]);
    if (!Number.isFinite(lat) || lat < 29 || lat > 34 || lng < 34 || lng > 36.5) continue;
    indexPoint(idx, owners, city, row.B, num, lat, lng);
    n += 1;
  }
  console.log("indexed workbook points", n);
}

function aliasMap(owners) {
  const alias = new Map();
  for (const [key, set] of owners) {
    if (set.size === 1) alias.set(key, [...set][0]);
  }
  return alias;
}

const sql = neon(url);
const idx = new Map();
const owners = new Map();
await loadPoints(idx, owners);
const alias = aliasMap(owners);
console.log("streets indexed", idx.size, "unique aliases", alias.size);

const clusters = await sql`
  SELECT c.ashkol, c.settlement_name, s.lat, s.lng
  FROM clusters c
  LEFT JOIN settlements s ON s.name_he = c.settlement_name
`;
const byAshkol = new Map(clusters.map((c) => [String(c.ashkol), c]));

const table = parseTsv(readFileSync(CSV_PATH, "utf8"));
const header = table[0];
const col = Object.fromEntries(header.map((name, i) => [name, i]));
for (const name of ["עיר", "אשכול", "רחוב", "מספרי בתים", "כתובות", "דלתות", "בוחרים"]) {
  if (col[name] == null) {
    console.error("missing column", name);
    process.exit(1);
  }
}

const streets = new Map();
const houses = [];
let missingAshkol = 0;
let ambiguous = 0;
let far = 0;
let listed = 0;

for (const cells of table.slice(1)) {
  if (cells.length === 1 && cells[0] === "") continue;
  const city = cells[col["עיר"]];
  const ashkol = String(cells[col["אשכול"]] ?? "").trim();
  const street = cells[col["רחוב"]];
  const cluster = byAshkol.get(ashkol);
  if (!cluster) {
    missingAshkol += 1;
    continue;
  }
  const settlement = cluster.settlement_name;
  const key = `${ashkol}\0${street}`;
  const prev = streets.get(key);
  streets.set(key, {
    ashkol,
    settlement_name: settlement,
    street_name: street,
    house_numbers: prev ? `${prev.house_numbers}, ${cells[col["מספרי בתים"]]}` : cells[col["מספרי בתים"]] || "",
    address_count: (prev?.address_count ?? 0) + parseCount(cells[col["כתובות"]]),
    door_count: (prev?.door_count ?? 0) + parseCount(cells[col["דלתות"]]),
    voter_count: (prev?.voter_count ?? 0) + parseCount(cells[col["בוחרים"]]),
  });

  const nums = parseRowNumbers(cells[col["מספרי בתים"]]);
  const tableHit = lookup(idx, alias, city, street);
  if (!tableHit) continue;
  const limit = farLimit(settlement);
  const origin =
    cluster.lat != null && cluster.lng != null ? [Number(cluster.lat), Number(cluster.lng)] : null;
  for (const n of nums) {
    listed += 1;
    const loc = dedupeNumber(tableHit.get(n));
    if (loc === "ambiguous") {
      ambiguous += 1;
      continue;
    }
    if (!loc) continue;
    if (origin && hav(origin, loc) > limit) {
      far += 1;
      continue;
    }
    houses.push({
      ashkol,
      settlement_name: settlement,
      street_name: street,
      house_number: n,
      lat: loc[0],
      lng: loc[1],
    });
  }
}

const houseKey = new Set();
const uniqueHouses = [];
for (const house of houses) {
  const key = `${house.ashkol}\0${house.street_name}\0${house.house_number}`;
  if (houseKey.has(key)) continue;
  houseKey.add(key);
  uniqueHouses.push(house);
}

console.log({
  streetRows: streets.size,
  houses: uniqueHouses.length,
  listed,
  ambiguous,
  far,
  missingAshkol,
});

await sql`TRUNCATE eshkol_houses, eshkol_streets`;

const streetRows = [...streets.values()];
const streetSize = 400;
for (let i = 0; i < streetRows.length; i += streetSize) {
  const chunk = streetRows.slice(i, i + streetSize);
  await sql`
    INSERT INTO eshkol_streets (
      ashkol, settlement_name, street_name, house_numbers, address_count, door_count, voter_count
    )
    SELECT * FROM UNNEST(
      ${chunk.map((r) => r.ashkol)}::text[],
      ${chunk.map((r) => r.settlement_name)}::text[],
      ${chunk.map((r) => r.street_name)}::text[],
      ${chunk.map((r) => r.house_numbers)}::text[],
      ${chunk.map((r) => r.address_count)}::int[],
      ${chunk.map((r) => r.door_count)}::int[],
      ${chunk.map((r) => r.voter_count)}::int[]
    )
  `;
  console.log("eshkol_streets", Math.min(i + streetSize, streetRows.length), "/", streetRows.length);
}

const houseSize = 400;
for (let i = 0; i < uniqueHouses.length; i += houseSize) {
  const chunk = uniqueHouses.slice(i, i + houseSize);
  await sql`
    INSERT INTO eshkol_houses (ashkol, settlement_name, street_name, house_number, lat, lng)
    SELECT * FROM UNNEST(
      ${chunk.map((r) => r.ashkol)}::text[],
      ${chunk.map((r) => r.settlement_name)}::text[],
      ${chunk.map((r) => r.street_name)}::text[],
      ${chunk.map((r) => r.house_number)}::int[],
      ${chunk.map((r) => r.lat)}::float8[],
      ${chunk.map((r) => r.lng)}::float8[]
    )
  `;
  console.log("eshkol_houses", Math.min(i + houseSize, uniqueHouses.length), "/", uniqueHouses.length);
}

const [{ streets: streetCount }] = await sql`SELECT count(*)::int AS streets FROM eshkol_streets`;
const [{ houses: houseCount }] = await sql`SELECT count(*)::int AS houses FROM eshkol_houses`;
console.log({ streetCount, houseCount });
