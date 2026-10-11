import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { canAccessAshkol } from "@/lib/streets-access";

export const runtime = "nodejs";

/**
 * Admin / רכז על: mark an ashkol as done or not done for ops reporting.
 * done=true → mark every street for the current user.
 * done=false → clear all street_marks on that ashkol (so status becomes לא בוצע).
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    ashkol?: string;
    done?: boolean;
  };
  const ashkol = body.ashkol?.trim() ?? "";
  if (!ashkol) {
    return NextResponse.json({ error: "ashkol חסר" }, { status: 400 });
  }
  const done = body.done === true;
  const sql = getSql();

  if (!(await canAccessAshkol(sql, user!, ashkol))) {
    return NextResponse.json({ error: "אין הרשאה לאשכול זה" }, { status: 403 });
  }

  const streets = (await sql`
    SELECT id FROM streets WHERE ashkol = ${ashkol}
  `) as { id: string }[];

  if (streets.length === 0) {
    return NextResponse.json({
      ashkol,
      updated: 0,
      done,
      message: "אין רחובות מקושרים לאשכול זה עדיין",
    });
  }

  if (!done) {
    const ids = streets.map((s) => s.id);
    await sql`
      DELETE FROM street_marks WHERE street_id = ANY(${ids})
    `;
    return NextResponse.json({ ashkol, updated: ids.length, done: false });
  }

  let updated = 0;
  for (const s of streets) {
    await sql`
      INSERT INTO street_marks (street_id, user_id, done, marked_at)
      VALUES (${s.id}, ${user!.id}, true, now())
      ON CONFLICT (street_id, user_id) DO UPDATE SET
        done = true, marked_at = now()
    `;
    updated += 1;
  }

  return NextResponse.json({ ashkol, updated, done: true });
}
