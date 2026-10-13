import { NextRequest, NextResponse } from "next/server";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";
import { getSql, type StreetRow } from "@/lib/db";

export const runtime = "nodejs";

const TILE_CACHE = {
  "Cache-Control": "public, max-age=300",
  "CDN-Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
  "Vercel-CDN-Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
};

function tileToBBox(z: number, x: number, y: number) {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const northRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const southRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n)));
  const north = (northRad * 180) / Math.PI;
  const south = (southRad * 180) / Math.PI;
  return { west, south, east, north };
}

function emptyTile() {
  return new NextResponse(null, { status: 204, headers: TILE_CACHE });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z: zs, x: xs, y: ys } = await ctx.params;
  const z = Number(zs);
  const x = Number(xs);
  const y = Number(ys.replace(/\.mvt$/i, ""));
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 16) {
    return new NextResponse("bad tile", { status: 400 });
  }

  // At country zoom, skip street vectors — LIMIT would drop arbitrary streets.
  if (z < 11) return emptyTile();

  const { west, south, east, north } = tileToBBox(z, x, y);
  const sql = getSql();
  const limit = z <= 12 ? 2500 : z <= 14 ? 5000 : 8000;

  const rows = (await sql`
    SELECT s.id, s.name_he, s.geom_geojson, s.ashkol
    FROM streets s
    WHERE s.bbox_xmax >= ${west} AND s.bbox_xmin <= ${east}
      AND s.bbox_ymax >= ${south} AND s.bbox_ymin <= ${north}
    ORDER BY s.id
    LIMIT ${limit}
  `) as Pick<StreetRow, "id" | "name_he" | "geom_geojson" | "ashkol">[];

  const fc = {
    type: "FeatureCollection" as const,
    features: rows.map((s) => ({
      type: "Feature" as const,
      properties: {
        id: s.id,
        name_he: s.name_he,
        ashkol: s.ashkol ?? "",
      },
      geometry: JSON.parse(s.geom_geojson),
    })),
  };

  const index = new geojsonvt(fc, {
    maxZoom: 16,
    indexMaxZoom: z,
    indexMaxPoints: 0,
  });
  const tile = index.getTile(z, x, y);
  if (!tile) return emptyTile();

  const buf = Buffer.from(vtpbf.fromGeojsonVt({ streets: tile }, { version: 2 }));
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/x-protobuf",
      ...TILE_CACHE,
    },
  });
}
