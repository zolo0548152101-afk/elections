import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { canAccessAshkol } from "@/lib/streets-access";

export const runtime = "nodejs";

/** Streets linked to a cluster ashkol (empty until import fills streets.ashkol). */
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
           COALESCE(m.done, false) AS done
    FROM streets s
    LEFT JOIN street_marks m
      ON m.street_id = s.id AND m.user_id = ${user.id}
    WHERE s.ashkol = ${ashkol}
    ORDER BY s.name_he, s.id
    LIMIT 500
  `;

  return NextResponse.json({ ashkol, streets, count: streets.length });
}
