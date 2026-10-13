import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { linkedAshkolSet } from "@/lib/cluster-status";
import { getSql } from "@/lib/db";
import { streetVisibilityFilter } from "@/lib/streets-access";

export const runtime = "nodejs";

/** Per-user street colouring and scope. Geometry tiles stay shared and cached. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getSql();
  const [vis, linked, doneRows] = await Promise.all([
    streetVisibilityFilter(sql, user),
    linkedAshkolSet(sql),
    sql`
      SELECT street_id
      FROM street_marks
      WHERE user_id = ${user.id} AND done
    `,
  ]);
  const done = doneRows as { street_id: string }[];

  return NextResponse.json(
    {
      doneStreetIds: done.map((row) => row.street_id),
      visibleAshkols: vis.active ? vis.ashkols : null,
      scopeActive: vis.active,
      linkedAshkols: [...linked],
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
