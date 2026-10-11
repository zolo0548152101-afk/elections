import { NextRequest, NextResponse } from "next/server";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";
import { getSessionUser } from "@/lib/auth";
import { getSql, type StreetRow } from "@/lib/db";

export const runtime = "nodejs";

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

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("unauthorized", { status: 401 });

  const { z: zs, x: xs, y: ys } = await ctx.params;
  const z = Number(zs);
  const x = Number(xs);
  const y = Number(ys.replace(/\.mvt$/i, ""));
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 16) {
    return new NextResponse("bad tile", { status: 400 });
  }

  const { west, south, east, north } = tileToBBox(z, x, y);
  const sql = getSql();
  const rows = (await sql`
    SELECT s.id, s.name_he, s.geom_geojson, s.ashkol, COALESCE(m.done, false) AS done
    FROM streets s
    LEFT JOIN street_marks m ON m.street_id = s.id
    WHERE s.bbox_xmax >= ${west} AND s.bbox_xmin <= ${east}
      AND s.bbox_ymax >= ${south} AND s.bbox_ymin <= ${north}
    LIMIT 4000
  `) as Pick<StreetRow, "id" | "name_he" | "geom_geojson" | "ashkol" | "done">[];

  const fc = {
    type: "FeatureCollection" as const,
    features: rows.map((s) => ({
      type: "Feature" as const,
      properties: {
        id: s.id,
        name_he: s.name_he,
        ashkol: s.ashkol ?? "",
        done: s.done ? 1 : 0,
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
  if (!tile) {
    return new NextResponse(new Uint8Array(), {
      status: 204,
      headers: { "Content-Type": "application/x-protobuf" },
    });
  }
  const buf = Buffer.from(vtpbf.fromGeojsonVt({ streets: tile }, { version: 2 }));
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/x-protobuf",
      "Cache-Control": "private, max-age=15",
    },
  });
}
