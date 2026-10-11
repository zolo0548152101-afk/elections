import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

/** Institutions linked (via join) to the viewer's team coordinators. */
export async function GET() {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sql = getSql();
  const rows =
    user!.role === "super_admin"
      ? await sql`
          SELECT i.id, i.name, i.kind, i.settlement_name, i.district,
                 count(DISTINCT link.user_id)::int AS coordinator_count,
                 count(DISTINCT ic.ashkol)::int AS cluster_count,
                 coalesce(
                   (
                     SELECT json_agg(
                       json_build_object('id', u.id, 'full_name', u.full_name)
                       ORDER BY u.full_name
                     )
                     FROM institution_coordinators l2
                     JOIN users u ON u.id = l2.user_id
                     WHERE l2.institution_id = i.id AND u.role = 'coordinator'
                   ),
                   '[]'
                 ) AS coordinators
          FROM institutions i
          JOIN institution_coordinators link ON link.institution_id = i.id
          JOIN users u ON u.id = link.user_id AND u.role = 'coordinator'
          LEFT JOIN institution_clusters ic ON ic.institution_id = i.id
          GROUP BY i.id
          ORDER BY i.name
        `
      : await sql`
          SELECT i.id, i.name, i.kind, i.settlement_name, i.district,
                 count(DISTINCT link.user_id)::int AS coordinator_count,
                 count(DISTINCT ic.ashkol)::int AS cluster_count,
                 coalesce(
                   (
                     SELECT json_agg(
                       json_build_object('id', u.id, 'full_name', u.full_name)
                       ORDER BY u.full_name
                     )
                     FROM institution_coordinators l2
                     JOIN users u ON u.id = l2.user_id
                     WHERE l2.institution_id = i.id
                       AND u.role = 'coordinator'
                       AND u.manager_id = ${user!.id}
                   ),
                   '[]'
                 ) AS coordinators
          FROM institutions i
          JOIN institution_coordinators link ON link.institution_id = i.id
          JOIN users u ON u.id = link.user_id
            AND u.role = 'coordinator'
            AND u.manager_id = ${user!.id}
          LEFT JOIN institution_clusters ic ON ic.institution_id = i.id
          GROUP BY i.id
          ORDER BY i.name
        `;

  return NextResponse.json({ institutions: rows });
}
