import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { canAccessAshkol } from "@/lib/streets-access";

export const runtime = "nodejs";

/**
 * Admin / רכז על: mark an ashkol as done or not done for ops reporting.
 * Persists in ashkol_ops_status (works even when no streets are linked yet).
 * When streets exist, also sync street_marks for map consistency.
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

  const cluster = (await sql`
    SELECT ashkol FROM clusters WHERE ashkol = ${ashkol} LIMIT 1
  `) as { ashkol: string }[];
  if (!cluster[0]) {
    return NextResponse.json({ error: "אשכול לא נמצא" }, { status: 404 });
  }

  await sql`
    INSERT INTO ashkol_ops_status (ashkol, done, updated_by, updated_at)
    VALUES (${ashkol}, ${done}, ${user!.id}, now())
    ON CONFLICT (ashkol) DO UPDATE SET
      done = EXCLUDED.done,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  `;

  const streets = (await sql`
    SELECT id FROM streets WHERE ashkol = ${ashkol}
  `) as { id: string }[];

  let streetsUpdated = 0;
  if (streets.length > 0) {
    if (!done) {
      const ids = streets.map((s) => s.id);
      await sql`
        DELETE FROM street_marks WHERE street_id = ANY(${ids})
      `;
      streetsUpdated = ids.length;
    } else {
      for (const s of streets) {
        await sql`
          INSERT INTO street_marks (street_id, user_id, done, marked_at)
          VALUES (${s.id}, ${user!.id}, true, now())
          ON CONFLICT (street_id, user_id) DO UPDATE SET
            done = true, marked_at = now()
        `;
        streetsUpdated += 1;
      }
    }
  }

  return NextResponse.json({
    ashkol,
    done,
    updated: 1,
    streetsUpdated,
  });
}
