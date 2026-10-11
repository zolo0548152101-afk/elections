import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql, type StreetRow } from "@/lib/db";
import { streetVisibilityFilter } from "@/lib/streets-access";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const west = Number(sp.get("west"));
  const south = Number(sp.get("south"));
  const east = Number(sp.get("east"));
  const north = Number(sp.get("north"));
  const ashkol = sp.get("ashkol");
  const limit = Math.min(Number(sp.get("limit") ?? "2500"), 5000);

  if (![west, south, east, north].every(Number.isFinite)) {
    return NextResponse.json({ error: "bbox required" }, { status: 400 });
  }

  const sql = getSql();
  const vis = await streetVisibilityFilter(sql, user);
  let rows: StreetRow[];
  if (ashkol) {
    rows = (await sql`
      SELECT s.id, s.name_he, s.lat, s.lng, s.bbox_xmin, s.bbox_ymin, s.bbox_xmax, s.bbox_ymax,
             s.geom_geojson, s.ashkol, COALESCE(m.done, false) AS done
      FROM streets s
      LEFT JOIN street_marks m ON m.street_id = s.id
      WHERE s.bbox_xmax >= ${west} AND s.bbox_xmin <= ${east}
        AND s.bbox_ymax >= ${south} AND s.bbox_ymin <= ${north}
        AND s.ashkol = ${ashkol}
      LIMIT ${limit}
    `) as StreetRow[];
  } else if (vis.active) {
    rows = (await sql`
      SELECT s.id, s.name_he, s.lat, s.lng, s.bbox_xmin, s.bbox_ymin, s.bbox_xmax, s.bbox_ymax,
             s.geom_geojson, s.ashkol, COALESCE(m.done, false) AS done
      FROM streets s
      LEFT JOIN street_marks m ON m.street_id = s.id
      WHERE s.bbox_xmax >= ${west} AND s.bbox_xmin <= ${east}
        AND s.bbox_ymax >= ${south} AND s.bbox_ymin <= ${north}
        AND s.ashkol = ANY(${vis.ashkols})
      LIMIT ${limit}
    `) as StreetRow[];
  } else {
    rows = (await sql`
      SELECT s.id, s.name_he, s.lat, s.lng, s.bbox_xmin, s.bbox_ymin, s.bbox_xmax, s.bbox_ymax,
             s.geom_geojson, s.ashkol, COALESCE(m.done, false) AS done
      FROM streets s
      LEFT JOIN street_marks m ON m.street_id = s.id
      WHERE s.bbox_xmax >= ${west} AND s.bbox_xmin <= ${east}
        AND s.bbox_ymax >= ${south} AND s.bbox_ymin <= ${north}
      LIMIT ${limit}
    `) as StreetRow[];
  }

  const features = rows.map((s) => ({
    type: "Feature" as const,
    id: s.id,
    properties: {
      id: s.id,
      name_he: s.name_he,
      ashkol: s.ashkol,
      done: Boolean(s.done),
    },
    geometry: JSON.parse(s.geom_geojson),
  }));

  return NextResponse.json({
    type: "FeatureCollection",
    features,
    count: features.length,
  });
}
