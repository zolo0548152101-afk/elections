import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { geometryFromGeoJson } from "@/lib/cluster-route";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const sql = getSql();
  const [street] = (await sql`
    SELECT id, name_he, geom_geojson FROM streets WHERE id = ${id} LIMIT 1
  `) as { id: string; name_he: string; geom_geojson: string }[];
  if (!street) return NextResponse.json({ error: "רחוב לא נמצא" }, { status: 404 });
  return NextResponse.json({
    id: street.id,
    name_he: street.name_he,
    geometry: geometryFromGeoJson(street.geom_geojson),
  });
}
