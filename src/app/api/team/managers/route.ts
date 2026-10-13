import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { clusterProgress } from "@/lib/cluster-status";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

/** מנהל only: list רכזי על with their coordinators and progress. */
export async function GET() {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sql = getSql();
  const managers = (await sql`
    SELECT id, full_name, email, mobile
    FROM users
    WHERE role = 'area_manager'
    ORDER BY full_name
  `) as {
    id: number;
    full_name: string;
    email: string;
    mobile: string | null;
  }[];

  const out = [];
  for (const m of managers) {
    const coords = (await sql`
      SELECT u.id, u.full_name, u.email,
             coalesce(
               (
                 SELECT string_agg(i.name, ' · ' ORDER BY i.name)
                 FROM institution_coordinators link
                 JOIN institutions i ON i.id = link.institution_id
                 WHERE link.user_id = u.id
               ),
               ''
             ) AS institution_names,
             coalesce(
               (
                 SELECT string_agg(
                   CASE
                     WHEN settlement_name IS NOT NULL AND btrim(settlement_name) <> ''
                     THEN ashkol || ' · ' || settlement_name
                     ELSE ashkol
                   END,
                   ', ' ORDER BY settlement_name, ashkol
                 )
                 FROM (
                   SELECT DISTINCT cl.ashkol, cl.settlement_name
                   FROM institution_coordinators link
                   JOIN institution_clusters ic ON ic.institution_id = link.institution_id
                   JOIN clusters cl ON cl.ashkol = ic.ashkol
                   WHERE link.user_id = u.id
                 ) distinct_ashkols
               ),
               ''
             ) AS ashkols,
             coalesce(
               (
                 SELECT count(DISTINCT ic.ashkol)::int
                 FROM institution_coordinators link
                 JOIN institution_clusters ic ON ic.institution_id = link.institution_id
                 WHERE link.user_id = u.id
               ),
               0
             ) AS cluster_count
      FROM users u
      WHERE u.role = 'coordinator' AND u.manager_id = ${m.id}
      ORDER BY u.full_name
    `) as {
      id: number;
      full_name: string;
      email: string;
      institution_names: string;
      ashkols: string;
      cluster_count: number;
    }[];

    const withProgress = [];
    for (const c of coords) {
      const institutions = (await sql`
        SELECT i.id, i.name, i.settlement_name
        FROM institution_coordinators link
        JOIN institutions i ON i.id = link.institution_id
        WHERE link.user_id = ${c.id}
        ORDER BY i.name
      `) as { id: number; name: string; settlement_name: string | null }[];

      const clusters = (await sql`
        SELECT cl.ashkol, cl.settlement_name, ic.institution_id, i.name AS institution_name
        FROM institution_coordinators link
        JOIN institution_clusters ic ON ic.institution_id = link.institution_id
        JOIN clusters cl ON cl.ashkol = ic.ashkol
        JOIN institutions i ON i.id = ic.institution_id
        WHERE link.user_id = ${c.id}
        ORDER BY cl.settlement_name, cl.ashkol, i.name
      `) as {
        ashkol: string;
        settlement_name: string;
        institution_id: number;
        institution_name: string;
      }[];

      const ashkols = [...new Set(clusters.map((row) => row.ashkol))];
      const progress = await clusterProgress(sql, ashkols);
      withProgress.push({ ...c, institutions, clusters, progress });
    }

    out.push({
      ...m,
      coordinators: withProgress,
      coordinator_count: withProgress.length,
    });
  }

  return NextResponse.json({ managers: out });
}
