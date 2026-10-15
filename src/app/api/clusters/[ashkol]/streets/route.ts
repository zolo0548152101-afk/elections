import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { canAccessAshkol } from "@/lib/streets-access";

export const runtime = "nodejs";

/** Streets linked to a cluster: owned lines (streets.ashkol) plus shared lines from eshkol_osm_streets,
 *  with the cluster's house (address), apartment and voter counts per line. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ ashkol: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { ashkol } = await ctx.params;
  if (!ashkol?.trim()) {
    return NextResponse.json({ error: "ashkol חסר" }, { status: 400 });
  }

  const sql = getSql();
  if (!(await canAccessAshkol(sql, user, ashkol))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const streets = await sql`
    SELECT s.id, s.name_he, s.lat, s.lng, s.ashkol,
           COALESCE(m.done, false) AS done,
           COALESCE(c.address_count, 0)::int AS address_count,
           COALESCE(c.door_count, 0)::int AS door_count,
           COALESCE(c.voter_count, 0)::int AS voter_count
    FROM streets s
    LEFT JOIN street_marks m
      ON m.street_id = s.id AND m.user_id = ${user.id}
    LEFT JOIN (
      SELECT l.street_id,
             SUM(es.address_count) AS address_count,
             SUM(es.door_count) AS door_count,
             SUM(es.voter_count) AS voter_count
      FROM eshkol_osm_streets l
      JOIN eshkol_streets es
        ON es.ashkol = l.ashkol AND es.street_name = l.street_name
      WHERE l.ashkol = ${ashkol}
      GROUP BY l.street_id
    ) c ON c.street_id = s.id
    WHERE s.ashkol = ${ashkol}
       OR s.id IN (SELECT street_id FROM eshkol_osm_streets WHERE ashkol = ${ashkol})
    ORDER BY s.name_he, s.id
    LIMIT 500
  `;

  return NextResponse.json({ ashkol, streets, count: streets.length });
}
