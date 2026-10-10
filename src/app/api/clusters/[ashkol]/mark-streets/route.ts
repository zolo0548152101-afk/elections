import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

/** Mark all streets linked to a cluster as done (after cluster-street table is loaded). */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ ashkol: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { ashkol } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { done?: boolean };
  const done = body.done !== false;
  const sql = getSql();

  const streets = (await sql`
    SELECT id FROM streets WHERE ashkol = ${ashkol}
  `) as { id: string }[];

  if (streets.length === 0) {
    return NextResponse.json({
      ashkol,
      updated: 0,
      message: "אין רחובות מקושרים לאשכול זה עדיין",
    });
  }

  if (done) {
    for (const s of streets) {
      await sql`
        INSERT INTO street_marks (street_id, done, marked_by, marked_at)
        VALUES (${s.id}, true, ${user.id}, now())
        ON CONFLICT (street_id) DO UPDATE SET
          done = true, marked_by = EXCLUDED.marked_by, marked_at = now()
      `;
    }
  } else {
    await sql`
      DELETE FROM street_marks
      WHERE street_id IN (SELECT id FROM streets WHERE ashkol = ${ashkol})
    `;
  }

  return NextResponse.json({ ashkol, updated: streets.length, done });
}
