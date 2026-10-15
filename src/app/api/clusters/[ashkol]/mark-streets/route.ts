import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { canAccessAshkol, canMarkStreet } from "@/lib/streets-access";

export const runtime = "nodejs";

/** Mark all streets linked to a cluster as done for the current user. */
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

  if (!(await canAccessAshkol(sql, user, ashkol))) {
    return NextResponse.json({ error: "אין הרשאה לאשכול זה" }, { status: 403 });
  }

  const streets = (await sql`
    SELECT id FROM streets WHERE ashkol = ${ashkol}
    UNION
    SELECT street_id AS id FROM eshkol_osm_streets WHERE ashkol = ${ashkol}
  `) as { id: string }[];

  let updated = 0;
  for (const s of streets) {
    if (!(await canMarkStreet(sql, user, s.id))) continue;
    if (done) {
      await sql`
        INSERT INTO street_marks (street_id, user_id, done, marked_at)
        VALUES (${s.id}, ${user.id}, true, now())
        ON CONFLICT (street_id, user_id) DO UPDATE SET
          done = true, marked_at = now()
      `;
    } else {
      await sql`
        DELETE FROM street_marks
        WHERE street_id = ${s.id} AND user_id = ${user.id}
      `;
    }
    updated += 1;
  }

  await sql`
    INSERT INTO ashkol_ops_status (ashkol, done, updated_by, updated_at)
    VALUES (${ashkol}, ${done}, ${user.id}, now())
    ON CONFLICT (ashkol) DO UPDATE SET
      done = ${done},
      updated_by = ${user.id},
      updated_at = now()
  `;

  return NextResponse.json({
    ashkol,
    updated,
    done,
    message:
      streets.length === 0
        ? done
          ? "האשכול סומן כבוצע"
          : "האשכול חזר לפתוח"
        : undefined,
  });
}
