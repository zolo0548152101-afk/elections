/**
 * Match the cluster-street workbook to map names and coordinates.
 *
 * 1. Take every named street already loaded in `streets` that falls inside
 *    each city in the workbook (the OSM copy the map draws).
 * 2. Match city+street inside that list with the same alias rules as the
 *    house importer.
 * 3. For the rest, ask GovMap (official Hebrew names + point), then
 *    Nominatim and Photon. A hit counts only when the result is in the
 *    same city and the street tokens agree.
 *
 * Usage:
 *   node scripts/match-osm-streets.mjs [workbook.xlsx]
 *
 * Writes data/osm-street-match.xlsx. Does not modify the database.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
config({ path: resolve(ROOT, ".env.local"), override: true });

const workbookArg = process.argv[2];
const WORKBOOK = workbookArg
  ? resolve(workbookArg)
  : "/home/ubuntu/.cursor/projects/workspace/uploads/______-__________________________________50_____1__caf2.xlsx";
const CACHE_PATH = resolve(ROOT, "data/.cache/govmap-cache.json");
const OUT_PATH = resolve(ROOT, "data/osm-street-match.xlsx");

const RADIUS_KM = {
  ירושלים: 16,
  "תל אביב  יפו": 12,
  "באר שבע": 12,
  נתניה: 10,
  אשקלון: 10,
  אשדוד: 10,
  "פתח תקווה": 8,
  "ראשון לציון": 8,
  דימונה: 8,
  אילת: 10,
  עפולה: 8,
  צפת: 7,
  טבריה: 7,
  רחובות: 7,
};

const DROP_WORDS = [
  "שד", "שדרות", "סמ", "סמטת", "סמטה", "שכ", "שכונת", "שכונה",
  "דרך", "משעול", "רחוב", "רח", "כביש", "שביל", "הרב", "רבי", "רחבת", "שדרה",
];

function norm(s) {
  let out = String(s || "").trim();
  out = out.replace(/["'׳״`]/g, "");
  out = out.replace(/[־\-–—]/g, " ").replace(/[()]/g, " ");
  out = out.replace(/\s+/g, " ").trim();
  // Fold words before final letters, otherwise קיבוץ becomes קיבוצ and the alias misses.
  out = out.replaceAll("קיבוץ", "קבוץ").replaceAll("קריית", "קרית");
  out = out.replaceAll("שיכון", "שכון");
  out = out.replace(/[ךםןףץ]/g, (ch) => "כמנפצ"["ךםןףץ".indexOf(ch)]);
  if (out.startsWith("רחוב ")) out = out.slice(5).trim();
  return out;
}

// "דרך" is written with a final כ, so the set has to use the same folding as norm().
const DROP = new Set(DROP_WORDS.map((word) => norm(word)));
const SUFFIXES = [["שד", "שדרות"], ["סמ", "סמטת"], ["שכ", "שכונת"], ["רח", "רחוב"], ["דרך", "דרך"]];

function cityAliases(city) {
  const n = norm(city);
  const list = [n];
  if (n === "תל אביב יפו") list.push("תל אביב יפו", "תל אביב-יפו");
  if (n === "מעלותתרשיחא") list.push("מעלות תרשיחא");
  if (n === "כפר חבד") list.push("כפר חבד");
  if (n.startsWith("קרית ")) list.push(n.replace("קרית ", "קריית "));
  return [...new Set(list.map((x) => norm(x)))];
}

function cityQuery(city) {
  const n = norm(city);
  if (n === "תל אביב יפו") return "תל אביב-יפו";
  if (n === "מעלותתרשיחא") return "מעלות תרשיחא";
  if (n === "כפר חבד") return "כפר חבד";
  return String(city).replace(/\s+/g, " ").trim();
}

function mentionsCity(text, city) {
  const t = norm(text);
  return cityAliases(city).some((a) => t === a || t.endsWith(` ${a}`) || t.startsWith(`${a} `) || t.includes(` ${a} `));
}

function prettyStreet(raw, city) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  const aliases = [...cityAliases(city), city, cityQuery(city)];
  const forms = [];
  for (const a of aliases) {
    forms.push(a, a.replace(/ /g, "-"), a.replace(/-/g, " "));
  }
  for (const a of [...new Set(forms)].sort((x, y) => y.length - x.length)) {
    if (a && (t === a || t.endsWith(` ${a}`))) {
      return t.slice(0, t.length - a.length).replace(/[-–\s]+$/g, "").trim();
    }
  }
  return "";
}

function stripCity(text, city) {
  let t = norm(text);
  const aliases = cityAliases(city).sort((a, b) => b.length - a.length);
  for (const a of aliases) {
    if (t.endsWith(` ${a}`)) return t.slice(0, -(a.length + 1)).trim();
    if (t === a) return "";
  }
  return t;
}

/** GovMap address-layer rows look like "מערך כתובות באר שבע שד בן גוריון 15". */
function entityStreet(text, city) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const aliases = [...cityAliases(city), city, cityQuery(city)];
  for (const a of [...new Set(aliases)].sort((x, y) => y.length - x.length)) {
    const at = raw.indexOf(a);
    if (at < 0) continue;
    const rest = raw.slice(at + a.length).replace(/[\d\s]+$/g, "").trim();
    if (rest) return rest;
  }
  return "";
}

function tokens(s) {
  return norm(s)
    .split(" ")
    .filter((t) => t && !DROP.has(t) && !/^\d+$/.test(t));
}

function isNoStreet(street, city) {
  const s = norm(street);
  if (!s || s === "ללא רחוב" || s === "ללא") return true;
  const flat = (value) => norm(value).replace(/ /g, "");
  return cityAliases(city).some((a) => flat(a) === flat(s));
}

/** Some registry rows store the Hebrew backwards (ץעמיחא = אחימעץ). */
function unreverse(s) {
  const text = String(s || "").trim();
  if (!text) return "";
  const finals = "ךםןףץ";
  const bad = text.split(/\s+/).some((word) => finals.includes(word[0]));
  if (!bad) return "";
  return [...text].reverse().join("").replace(/\s+/g, " ").trim();
}

function streetKeys(s) {
  const base = norm(s);
  const keys = [];
  const add = (k) => {
    const cleaned = k.replace(/\s+/g, " ").trim();
    if (cleaned && !keys.includes(cleaned)) keys.push(cleaned);
  };
  add(base);
  if (base.startsWith("ש ") && !base.startsWith("שד ") && !base.startsWith("שכ ")) {
    const rest = base.slice(2).trim();
    add(`שדרות ${rest}`);
    add(`שכונת ${rest}`);
    add(`שיכון ${rest}`);
  }
  const reps = [
    ["שדרות ", "שד "],
    ["שד ", "שדרות "],
    ["שכון ", ""],
    ["סמטת ", "סמ "],
    ["סמ ", "סמטת "],
  ];
  for (const [a, b] of reps) {
    if (base.startsWith(a)) add((b + base.slice(a.length)).trim());
  }
  for (const pref of ["שדרות ", "שד ", "סמטת ", "סמטה ", "סמ ", "משעול ", "שכונת ", "שכונה ", "שכ ", "דרך ", "שכון ", "כביש "]) {
    if (base.startsWith(pref)) add(base.slice(pref.length).trim());
  }
  return keys;
}

function havKm(a, b) {
  const r = 6371;
  const p1 = (a[0] * Math.PI) / 180;
  const p2 = (b[0] * Math.PI) / 180;
  const dphi = ((b[0] - a[0]) * Math.PI) / 180;
  const dl = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** One inserted or swapped י/ו/ה/א, the letters that flip Hebrew spelling without changing the name. */
function matresSlip(a, b) {
  if (!a || !b || Math.abs(a.length - b.length) > 1) return false;
  const soft = "יוה";
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length === b.length) {
      // Swapping a real consonant (ע/צ/ק) for א is a different name.
      if (!soft.includes(a[i]) || !soft.includes(b[j])) return false;
      i += 1;
      j += 1;
    } else if (a.length > b.length) {
      if (!soft.includes(a[i])) return false;
      i += 1;
    } else if (!soft.includes(b[j])) return false;
    else j += 1;
  }
  const rest = a.slice(i) + b.slice(j);
  if (rest) {
    edits += 1;
    if (edits > 1 || [...rest].some((ch) => !soft.includes(ch))) return false;
  }
  return edits === 1;
}

/**
 * 0 exact, 1 same tokens, 2 matres slip, 3 query tokens are a subset
 * of a slightly longer official name. null = do not match.
 */
function coreToken(t) {
  return t.startsWith("ה") && t.length > 3 ? t.slice(1) : t;
}

function sameTokens(a, b) {
  const at = a.map(coreToken).sort().join(" ");
  const bt = b.map(coreToken).sort().join(" ");
  return Boolean(at) && at === bt;
}

function agreeLevel(query, candidate) {
  const forms = [query, unreverse(query)].filter(Boolean);
  let best = null;
  for (const raw of forms) {
    const expanded = [raw];
    const n = norm(raw);
    for (const [suf, exp] of SUFFIXES) {
      const folded = norm(suf);
      if (n.endsWith(` ${folded}`)) expanded.push(`${exp} ${n.slice(0, -(folded.length + 1)).trim()}`);
    }
    for (const form of expanded) {
      const q = norm(form);
      const c = norm(candidate);
      if (!q || !c) continue;
      if (q === c) return 0;
      // "ש כנען" is a neighborhood/boulevard, not the street כנען.
      if (q.startsWith("ש ")) {
        const rest = tokens(q.slice(2));
        const kind = c.startsWith("שכונ") || c.startsWith("שכון") || c.startsWith("שדר") || c.startsWith("רחוב");
        if (kind && sameTokens(rest, tokens(candidate))) return 1;
        continue;
      }
      const qt = tokens(form);
      const ct = tokens(candidate);
      if (sameTokens(qt, ct)) return 1;
      const joined = qt.join(" ");
      const longEnough = joined.includes(" ") || joined.length >= 6;
      if (longEnough && matresSlip(qt.map(coreToken).join(" "), ct.map(coreToken).join(" "))) {
        best = best == null ? 2 : Math.min(best, 2);
        continue;
      }
      if (qt.length >= 2 || (qt.length === 1 && qt[0].length >= 5)) {
        const cset = new Set(ct.map(coreToken));
        const extra = ct.length - qt.length;
        if (qt.map(coreToken).every((t) => cset.has(t)) && extra > 0 && extra <= 2) {
          best = best == null ? 3 : Math.min(best, 3);
        }
      }
    }
  }
  return best;
}

function webMercatorToWgs(x, y) {
  const lng = (x / 20037508.34) * 180;
  const merc = (y / 20037508.34) * 180;
  const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((merc * Math.PI) / 180)) - Math.PI / 2);
  return [lat, lng];
}

function parsePoint(shape) {
  const m = /POINT\(([-\d.]+)\s+([-\d.]+)\)/.exec(shape || "");
  if (!m) return null;
  const [lat, lng] = webMercatorToWgs(Number(m[1]), Number(m[2]));
  if (!Number.isFinite(lat) || lat < 29 || lat > 34 || lng < 34 || lng > 36.5) return null;
  return [lat, lng];
}

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
}

let cache = loadCache();
let cacheWrites = 0;
function saveCache() {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache));
  cacheWrites = 0;
}

async function govmap(text, wider = false) {
  const key = wider ? `${text}|15` : text;
  if (cache[key]) return cache[key];
  if (!wider && Array.isArray(cache[text])) return cache[text];
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch("https://www.govmap.gov.il/api/search-service/autocomplete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Origin: "https://www.govmap.gov.il",
          Referer: "https://www.govmap.gov.il/",
        },
        body: JSON.stringify({
          searchText: text,
          language: "he",
          isAccurate: false,
          maxResults: wider ? 15 : 8,
        }),
      });
      if (!res.ok) throw new Error(`govmap ${res.status}`);
      const data = await res.json();
      const results = (data.results || []).map((r) => ({
        type: r.type,
        text: r.text,
        originalText: r.originalText || "",
        shape: r.shape,
        score: r.score,
      }));
      cache[key] = results;
      cacheWrites += 1;
      if (cacheWrites >= 40) saveCache();
      return results;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  console.error("govmap failed", text, lastErr?.message);
  cache[key] = [];
  return [];
}

const TYPE_RANK = { street: 0, neighborhood: 1, address: 2, poi: 3, institutes: 4 };

function bestGovmap(results, city, street, center, limitKm) {
  const cands = [];
  for (const res of results) {
    const blob = `${res.text || ""} ${res.originalText || ""}`;
    if (!mentionsCity(blob, city)) continue;
    const point = parsePoint(res.shape);
    if (!point || havKm(center, point) > limitKm) continue;
    const entity = String(res.type || "").includes("entity");
    const parsed = entity ? entityStreet(res.text || res.originalText || "", city) : "";
    const official = parsed || stripCity(res.originalText || res.text, city);
    const echoed = parsed || stripCity(res.text, city);
    const level = [official, echoed]
      .map((name) => agreeLevel(street, name))
      .filter((n) => n != null)
      .sort((a, b) => a - b)[0];
    if (level == null) continue;
    if (level >= 3 && !entity && res.type !== "street" && res.type !== "neighborhood" && res.type !== "address") continue;
    const rank = TYPE_RANK[res.type] ?? 9;
    cands.push({
      level,
      rank,
      mapName: prettyStreet(res.originalText || res.text, city) || official || echoed,
      lat: point[0],
      lng: point[1],
      method: `govmap-${res.type}`,
    });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.level - b.level || a.rank - b.rank);
  const best = cands[0];
  if (best.level >= 3) {
    const names = new Set(cands.filter((c) => c.level === best.level).map((c) => norm(c.mapName)));
    if (names.size !== 1) return null;
  }
  return best;
}

/** Last automatic pass: every meaningful token is in one official name. */
function looseGovmap(results, city, street, center, limitKm) {
  const qt = tokens(unreverse(street) || street).filter((t) => t.length >= 3);
  if (!qt.length) return null;
  const cands = [];
  for (const res of results) {
    const blob = `${res.text || ""} ${res.originalText || ""}`;
    if (!mentionsCity(blob, city)) continue;
    const point = parsePoint(res.shape);
    if (!point || havKm(center, point) > limitKm) continue;
    const entity = String(res.type || "").includes("entity");
    const name = (entity ? entityStreet(res.text || "", city) : "") || stripCity(res.originalText || res.text, city);
    if (!name) continue;
    const ct = tokens(name);
    const cset = new Set(ct.map(coreToken));
    if (!qt.every((t) => cset.has(coreToken(t)))) continue;
    const qn = norm(unreverse(street) || street);
    const placeQuery = /מלון|ישיב|קליטה|מוזיאון|מנזר|מעון|אבות|הוסטל/.test(street);
    const kind = res.type || "";
    if (qn.startsWith("ש ") && kind === "street" && !/שכונ|שכון|שדר/.test(norm(name))) continue;
    if ((kind === "poi" || kind === "institutes") && !placeQuery) continue;
    const maxExtra = kind === "street" ? 2 : placeQuery ? 4 : 1;
    if (Math.max(0, ct.length - qt.length) > maxExtra) continue;
    cands.push({
      mapName: prettyStreet(res.originalText || res.text, city) || name,
      lat: point[0],
      lng: point[1],
      extra: Math.max(0, ct.length - qt.length),
      method: `govmap-loose-${res.type || "hit"}`,
    });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.extra - b.extra);
  const names = new Set(cands.filter((c) => c.extra === cands[0].extra).map((c) => norm(c.mapName)));
  if (names.size !== 1) return null;
  return cands[0];
}

let nominatimNext = 0;
async function nominatim(street, city) {
  const wait = nominatimNext - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  nominatimNext = Date.now() + 1100;
  const q = `${street}, ${cityQuery(city)}, ישראל`;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "he");
  url.searchParams.set("countrycodes", "il");
  url.searchParams.set("limit", "5");
  url.searchParams.set("q", q);
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": "election-day-ops/street-match (reconciliation)" },
  });
  if (!res.ok) return [];
  return res.json();
}

async function photon(street, city, center) {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", `${street} ${cityQuery(city)}`);
  url.searchParams.set("lang", "he");
  url.searchParams.set("limit", "5");
  url.searchParams.set("lat", String(center[0]));
  url.searchParams.set("lon", String(center[1]));
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": "election-day-ops/street-match" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.features || [];
}

function pickLocal(streets, street) {
  const hits = [];
  for (const s of streets) {
    const level = agreeLevel(street, s.name_he);
    if (level == null) continue;
    hits.push({ ...s, level });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.level - b.level || a.dCenter - b.dCenter);
  const best = hits[0];
  // A longer official name (דוד בן גוריון for בן גוריון) only if it is the only one in the city.
  if (best.level >= 3) {
    const names = new Set(hits.filter((h) => h.level === best.level).map((h) => norm(h.name_he)));
    if (names.size !== 1) return null;
  }
  const method = ["osm-exact", "osm-alias", "osm-fuzzy", "osm-subset"][best.level] || "osm-fuzzy";
  return {
    mapName: best.name_he,
    streetId: best.id,
    lat: best.lat,
    lng: best.lng,
    source: "osm",
    method,
  };
}

function queryVariants(street) {
  const out = [];
  const add = (s) => {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (t && !out.includes(t)) out.push(t);
  };
  const rev = unreverse(street);
  for (const base of [street, rev].filter(Boolean)) {
    add(base);
    for (const key of streetKeys(base)) add(key);
    const n = norm(base);
    for (const [suf, exp] of SUFFIXES) {
      const folded = norm(suf);
      if (n.endsWith(` ${folded}`)) add(`${exp} ${n.slice(0, -(folded.length + 1)).trim()}`);
    }
    if (n.startsWith("ש ")) {
      const rest = n.slice(2).trim();
      add(`שכונת ${rest}`);
      add(`שיכון ${rest}`);
      add(`שדרות ${rest}`);
      add(`רחוב ${rest}`);
    }
    const numeral = n.match(/(?:רחוב |רח )?(י|כ|ל|מ|נ|ס|ע|פ|צ|ק|ר|ש)([א-ט])$/);
    if (numeral) add(`${numeral[1]}"${numeral[2]}`);
  }
  return out.slice(0, 6);
}

function snapToOsm(streets, hit) {
  let best = null;
  for (const s of streets) {
    const d = havKm([hit.lat, hit.lng], [s.lat, s.lng]);
    if (d > 0.25) continue;
    const level = agreeLevel(hit.mapName, s.name_he);
    if (level == null || level >= 3) continue;
    if (!best || level < best.level || (level === best.level && d < best.d)) {
      best = { s, level, d };
    }
  }
  if (!best) return hit;
  return {
    ...hit,
    mapName: best.s.name_he,
    streetId: best.s.id,
    source: hit.source,
    method: `${hit.method}+osm`,
  };
}

function acceptExternal(hit, city, street, center, limitKm) {
  if (!hit) return null;
  if (havKm(center, [hit.lat, hit.lng]) > limitKm) return null;
  return hit;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL missing");
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);
  console.log("loading OSM streets from the map database");
  const dbStreets = await sql`SELECT id, name_he, lat, lng FROM streets`;
  const settlementRows = await sql`SELECT name_he, lat, lng FROM settlements`;
  const settlements = JSON.parse(readFileSync(resolve(ROOT, "data/settlement_coords.json"), "utf8"));
  for (const row of settlementRows) {
    if (row.lat == null || row.lng == null) continue;
    settlements[row.name_he] = [Number(row.lat), Number(row.lng)];
    const key = norm(row.name_he);
    if (!settlements[key]) settlements[key] = [Number(row.lat), Number(row.lng)];
  }
  // File spelling differs from the settlement table.
  if (!settlements["כפר חב\"ד"] && settlements["כפר חבד"]) {
    settlements["כפר חב\"ד"] = settlements["כפר חבד"];
  }
  if (!settlements["קרית ארבע"]) {
    const hit = settlementRows.find((r) => norm(r.name_he) === "קרית ארבע");
    if (hit) settlements["קרית ארבע"] = [Number(hit.lat), Number(hit.lng)];
  }

  const wb = XLSX.read(readFileSync(WORKBOOK));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const header = rows[0].map((c) => String(c));
  const dataRows = rows.slice(1).filter((r) => String(r[0] || "").trim());

  const cities = [...new Set(dataRows.map((r) => String(r[0]).trim()))];
  for (const city of cities) {
    if (settlements[city]) continue;
    const alias = cityQuery(city);
    const results = await govmap(alias);
    const hit = results.find((r) => r.type === "settlement" && mentionsCity(r.text, city));
    const point = hit ? parsePoint(hit.shape) : null;
    if (!point) {
      console.error("missing city center", city);
      process.exit(1);
    }
    settlements[city] = point;
    console.log("city center from govmap", city, point.map((n) => n.toFixed(5)).join(","));
  }

  const buckets = new Map();
  for (const s of dbStreets) {
    const lat = Number(s.lat);
    const lng = Number(s.lng);
    const key = `${Math.floor(lat / 0.2)}:${Math.floor(lng / 0.2)}`;
    const list = buckets.get(key);
    const rec = { id: s.id, name_he: s.name_he, lat, lng };
    if (list) list.push(rec);
    else buckets.set(key, [rec]);
  }
  function nearby(center, limitKm) {
    const [lat, lng] = center;
    const pad = limitKm / 90;
    const out = [];
    const i0 = Math.floor((lat - pad) / 0.2);
    const i1 = Math.floor((lat + pad) / 0.2);
    const j0 = Math.floor((lng - pad) / 0.2);
    const j1 = Math.floor((lng + pad) / 0.2);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (const s of buckets.get(`${i}:${j}`) || []) {
          const d = havKm(center, [s.lat, s.lng]);
          if (d <= limitKm) out.push({ ...s, dCenter: d });
        }
      }
    }
    return out;
  }

  const byCity = new Map();
  let catalogCount = 0;
  for (const city of cities) {
    const limit = RADIUS_KM[city] ?? 6.5;
    const list = nearby(settlements[city], limit);
    byCity.set(city, list);
    catalogCount += list.length;
  }
  console.log({ cities: cities.length, osmInCities: catalogCount, rows: dataRows.length });

  const pairs = new Map();
  for (const r of dataRows) {
    const city = String(r[0]).trim();
    const street = String(r[2]).trim();
    const key = `${city}\0${street}`;
    if (!pairs.has(key)) pairs.set(key, { city, street });
  }
  console.log("unique city+street", pairs.size);

  const matched = new Map();
  const pending = [];
  for (const pair of pairs.values()) {
    const { city, street } = pair;
    const center = settlements[city];
    const limit = RADIUS_KM[city] ?? 6.5;
    if (isNoStreet(street, city)) {
      matched.set(`${city}\0${street}`, {
        mapName: city,
        streetId: "",
        lat: center[0],
        lng: center[1],
        source: "settlement",
        method: "settlement",
      });
      continue;
    }
    const local = pickLocal(byCity.get(city), street);
    if (local) {
      matched.set(`${city}\0${street}`, local);
      continue;
    }
    pending.push(pair);
  }
  console.log("osm or settlement", matched.size, "need external", pending.length);

  let done = 0;
  async function resolveExternal(pair) {
    const { city, street } = pair;
    const key = `${city}\0${street}`;
    const center = settlements[city];
    const limit = (RADIUS_KM[city] ?? 6.5) + 1;
    const qs = queryVariants(street).map((s) => `${s} ${cityQuery(city)}`.replace(/\s+/g, " ").trim());
    let hit = null;
    for (const q of qs) {
      let results = await govmap(q);
      hit = bestGovmap(results, city, street, center, limit);
      if (!hit && results.length < 15) {
        results = await govmap(q, true);
        hit = bestGovmap(results, city, street, center, limit);
      }
      if (hit) break;
    }
    if (hit) {
      matched.set(key, snapToOsm(byCity.get(city), {
        mapName: hit.mapName,
        streetId: "",
        lat: hit.lat,
        lng: hit.lng,
        source: "govmap",
        method: hit.method,
      }));
    }
    done += 1;
    if (done % 50 === 0) console.log("external", done, "/", pending.length);
  }

  const queue = [...pending];
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const pair = queue.shift();
      await resolveExternal(pair);
    }
  });
  await Promise.all(workers);
  saveCache();

  let looseLeft = [...pairs.values()].filter((p) => !matched.has(`${p.city}\0${p.street}`));
  console.log("before loose", looseLeft.length);
  for (const pair of looseLeft) {
    const { city, street } = pair;
    const center = settlements[city];
    const limit = (RADIUS_KM[city] ?? 6.5) + 1;
    let hit = null;
    for (const q of queryVariants(street).map((s) => `${s} ${cityQuery(city)}`.replace(/\s+/g, " ").trim())) {
      const results = cache[q] || cache[`${q}|15`] || [];
      hit = looseGovmap(results, city, street, center, limit);
      if (hit) break;
    }
    if (!hit) continue;
    matched.set(`${city}\0${street}`, snapToOsm(byCity.get(city), {
      mapName: hit.mapName,
      streetId: "",
      lat: hit.lat,
      lng: hit.lng,
      source: "govmap",
      method: hit.method,
    }));
  }

  const still = [...pairs.values()].filter((p) => !matched.has(`${p.city}\0${p.street}`));
  console.log("after govmap, still open", still.length);
  for (const p of still) console.log("  GAP", p.city, "|", p.street);

  let nomiDone = 0;
  for (const pair of still) {
    nomiDone += 1;
    if (nomiDone % 20 === 0) console.log("nominatim", nomiDone, "/", still.length);
    const { city, street } = pair;
    const key = `${city}\0${street}`;
    const center = settlements[city];
    const limit = (RADIUS_KM[city] ?? 6.5) + 2;
    try {
      let hit = null;
      for (const variant of queryVariants(street).slice(0, 1)) {
        const results = await nominatim(variant, city);
        for (const res of results) {
          const lat = Number(res.lat);
          const lng = Number(res.lon);
          if (havKm(center, [lat, lng]) > limit) continue;
          const addr = res.address || {};
          const place = [addr.city, addr.town, addr.village, addr.municipality, addr.suburb].filter(Boolean).join(" ");
          const road = addr.road || addr.neighbourhood || "";
          if (!mentionsCity(`${place} ${res.display_name || ""}`, city) && havKm(center, [lat, lng]) > 3) continue;
          const roadLevel = agreeLevel(street, road);
          const nameLevel = agreeLevel(street, res.name || "");
          if (roadLevel == null && nameLevel == null) continue;
          hit = {
            mapName: roadLevel != null ? road : res.name,
            streetId: "",
            lat,
            lng,
            source: "nominatim",
            method: "nominatim",
          };
          break;
        }
        if (hit) break;
      }
      if (hit) {
        matched.set(key, snapToOsm(byCity.get(city), hit));
        continue;
      }
    } catch (err) {
      console.error("nominatim", street, city, err.message);
    }
    try {
      const features = await photon(unreverse(street) || street, city, center);
      for (const f of features) {
        const [lng, lat] = f.geometry.coordinates;
        if (havKm(center, [lat, lng]) > limit) continue;
        const props = f.properties || {};
        const place = props.city || props.town || props.county || "";
        const road = props.street || props.name || "";
        if (!mentionsCity(`${place} ${road}`, city) && !norm(place).includes(norm(city).slice(0, 4))) continue;
        if (agreeLevel(street, road) == null && agreeLevel(street, props.name || "") == null) continue;
        matched.set(key, snapToOsm(byCity.get(city), {
          mapName: road || props.name || street,
          streetId: "",
          lat,
          lng,
          source: "photon",
          method: "photon",
        }));
        break;
      }
    } catch (err) {
      console.error("photon", street, city, err.message);
    }
  }

  const open = [...pairs.values()].filter((p) => !matched.has(`${p.city}\0${p.street}`));
  console.log("unmatched pairs", open.length);
  for (const p of open) console.log("  OPEN", p.city, "|", p.street);

  const outRows = dataRows.map((r) => {
    const city = String(r[0]).trim();
    const street = String(r[2]).trim();
    const hit = matched.get(`${city}\0${street}`);
    return [
      ...r.slice(0, 7),
      hit?.mapName ?? "",
      hit?.streetId ?? "",
      hit?.lat ?? "",
      hit?.lng ?? "",
      hit?.source ?? "",
      hit?.method ?? "unmatched",
    ];
  });
  const outHeader = [
    ...header.slice(0, 7),
    "map_name",
    "street_id",
    "lat",
    "lng",
    "source",
    "match_method",
  ];
  const review = [["עיר", "רחוב", "סיבה"], ...open.map((p) => [p.city, p.street, "no map hit"])];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([outHeader, ...outRows]), "matched");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(review), "review");
  XLSX.writeFile(book, OUT_PATH);

  const byMethod = {};
  for (const hit of matched.values()) byMethod[hit.method] = (byMethod[hit.method] || 0) + 1;
  const located = dataRows.filter((r) => matched.has(`${String(r[0]).trim()}\0${String(r[2]).trim()}`)).length;
  console.log({
    pairs: pairs.size,
    locatedPairs: matched.size,
    rows: dataRows.length,
    locatedRows: located,
    pct: ((matched.size / pairs.size) * 100).toFixed(1),
    byMethod,
    out: OUT_PATH,
  });
}

await main();
