import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { visibleClusterAshkols } from "@/lib/streets-access";

export const runtime = "nodejs";

type StreetRow = {
  ashkol: string;
  street: string;
  geom: string;
};

/** OSM street lines for one settlement, colored later by ashkol. One street may repeat per eshkol. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { name } = await ctx.params;
  const settlement = name?.trim();
  if (!settlement) {
    return NextResponse.json({ error: "ישוב חסר" }, { status: 400 });
  }

  const sql = getSql();
  const allowed = await visibleClusterAshkols(sql, user);
  const rows = (
    allowed === null
      ? await sql`
          SELECT l.ashkol, l.street_name AS street, s.geom_geojson AS geom
          FROM eshkol_osm_streets l
          JOIN eshkol_streets e ON e.ashkol = l.ashkol AND e.street_name = l.street_name
          JOIN streets s ON s.id = l.street_id
          WHERE e.settlement_name = ${settlement}
          ORDER BY l.ashkol, l.street_name
        `
      : allowed.length === 0
        ? []
        : await sql`
          SELECT l.ashkol, l.street_name AS street, s.geom_geojson AS geom
          FROM eshkol_osm_streets l
          JOIN eshkol_streets e ON e.ashkol = l.ashkol AND e.street_name = l.street_name
          JOIN streets s ON s.id = l.street_id
          WHERE e.settlement_name = ${settlement}
            AND l.ashkol = ANY(${allowed})
          ORDER BY l.ashkol, l.street_name
        `
  ) as StreetRow[];

  const streets = [];
  for (const row of rows) {
    let geometry: { type: string; coordinates: unknown };
    try {
      geometry = JSON.parse(row.geom) as { type: string; coordinates: unknown };
    } catch {
      continue;
    }
    if (!geometry || (geometry.type !== "LineString" && geometry.type !== "MultiLineString")) continue;
    streets.push({ ashkol: row.ashkol, street: row.street, geometry });
  }

  return NextResponse.json({ settlement, streets });
}
