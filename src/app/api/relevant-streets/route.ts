import { readFileSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { eshkolColorMap } from "@/lib/eshkol-house-colors";
import { visibleClusterAshkols } from "@/lib/streets-access";

export const runtime = "nodejs";

type Indexed = {
  id?: string;
  name: string;
  city: string;
  lat?: number;
  lng?: number;
  ashkol: string;
  ashkols: string[];
};

type IndexFile = {
  streets: Indexed[];
  points: Indexed[];
};

let indexCache: IndexFile | null = null;

function loadIndex(): IndexFile {
  if (indexCache) return indexCache;
  const raw = readFileSync(join(process.cwd(), "data/relevant-streets.json"), "utf8");
  indexCache = JSON.parse(raw) as IndexFile;
  return indexCache;
}

function allowedSet(allowed: string[] | null): Set<string> | null {
  return allowed === null ? null : new Set(allowed);
}

function keep(entry: Indexed, allowed: Set<string> | null): boolean {
  if (!allowed) return true;
  return entry.ashkols.some((ashkol) => allowed.has(ashkol));
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getSql();
  const allowed = allowedSet(await visibleClusterAshkols(sql, user));
  const index = loadIndex();
  const streets = index.streets.filter((row) => keep(row, allowed));
  const points = index.points.filter((row) => keep(row, allowed));

  const colors = new Map<string, string>();
  const byCity = new Map<string, string[]>();
  for (const row of [...streets, ...points]) {
    const list = byCity.get(row.city) ?? [];
    list.push(...row.ashkols);
    byCity.set(row.city, list);
  }
  for (const [city, ashkols] of byCity) {
    for (const [ashkol, color] of eshkolColorMap(ashkols)) {
      colors.set(`${city}\0${ashkol}`, color);
    }
  }

  const ids = streets.map((row) => row.id).filter((id): id is string => Boolean(id));
  const geoms =
    ids.length === 0
      ? []
      : ((await sql`
          SELECT id, geom_geojson
          FROM streets
          WHERE id = ANY(${ids})
        `) as { id: string; geom_geojson: string }[]);
  const geomById = new Map(geoms.map((row) => [row.id, row.geom_geojson]));

  const features = [];
  for (const row of streets) {
    const raw = row.id ? geomById.get(row.id) : undefined;
    if (!raw) continue;
    const color = colors.get(`${row.city}\0${row.ashkol}`) ?? "#334155";
    features.push({
      type: "Feature" as const,
      id: row.id,
      properties: {
        id: row.id,
        name: row.name,
        city: row.city,
        ashkol: row.ashkol,
        ashkols: `|${row.ashkols.join("|")}|`,
        color,
      },
      geometry: JSON.parse(raw),
    });
  }
  for (const row of points) {
    if (row.lat == null || row.lng == null) continue;
    const color = colors.get(`${row.city}\0${row.ashkol}`) ?? "#334155";
    features.push({
      type: "Feature" as const,
      properties: {
        id: "",
        name: row.name,
        city: row.city,
        ashkol: row.ashkol,
        ashkols: `|${row.ashkols.join("|")}|`,
        color,
      },
      geometry: { type: "Point" as const, coordinates: [row.lng, row.lat] },
    });
  }

  return NextResponse.json({
    type: "FeatureCollection",
    features,
  });
}
