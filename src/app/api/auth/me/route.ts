import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null });

  const sql = getSql();
  let progress = { done: 0, total: 0 };
  if (user.role === "coordinator" && user.settlement_name) {
    const [row] = (await sql`
      SELECT
        count(*)::int AS total,
        count(m.street_id) FILTER (WHERE m.done)::int AS done
      FROM streets s
      LEFT JOIN street_marks m ON m.street_id = s.id AND m.done
      WHERE s.lat BETWEEN (
        SELECT lat - 0.08 FROM settlements WHERE name_he = ${user.settlement_name} LIMIT 1
      ) AND (
        SELECT lat + 0.08 FROM settlements WHERE name_he = ${user.settlement_name} LIMIT 1
      )
      AND s.lng BETWEEN (
        SELECT lng - 0.08 FROM settlements WHERE name_he = ${user.settlement_name} LIMIT 1
      ) AND (
        SELECT lng + 0.08 FROM settlements WHERE name_he = ${user.settlement_name} LIMIT 1
      )
    `) as { total: number; done: number }[];
    progress = row ?? progress;
  } else if (user.role === "super_admin") {
    const [row] = (await sql`
      SELECT
        (SELECT count(*)::int FROM streets) AS total,
        (SELECT count(*)::int FROM street_marks WHERE done) AS done
    `) as { total: number; done: number }[];
    progress = row ?? progress;
  } else if (user.role === "area_manager") {
    const [row] = (await sql`
      SELECT
        count(DISTINCT s.id)::int AS total,
        count(DISTINCT m.street_id) FILTER (WHERE m.done)::int AS done
      FROM users u
      JOIN settlements st ON st.name_he = u.settlement_name
      JOIN streets s ON s.lat BETWEEN st.lat - 0.08 AND st.lat + 0.08
                    AND s.lng BETWEEN st.lng - 0.08 AND st.lng + 0.08
      LEFT JOIN street_marks m ON m.street_id = s.id
      WHERE u.manager_id = ${user.id} AND u.role = 'coordinator'
    `) as { total: number; done: number }[];
    progress = row ?? progress;
  }

  let settlement: { name_he: string; lat: number; lng: number } | null = null;
  if (user.settlement_name) {
    const [row] = (await sql`
      SELECT name_he, lat, lng FROM settlements
      WHERE name_he = ${user.settlement_name}
      LIMIT 1
    `) as { name_he: string; lat: number; lng: number }[];
    settlement = row ?? null;
  }

  return NextResponse.json({ user, progress, settlement });
}
