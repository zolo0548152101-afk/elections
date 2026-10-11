import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { coordinatorInstitutionCities } from "@/lib/streets-access";

export const runtime = "nodejs";

const CITY_PAD = 0.08;

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

      const cityList = await coordinatorInstitutionCities(sql, c.id);
      let progress = { done: 0, total: 0, pct: 0 };
      if (cityList.length > 0) {
        const [row] = (await sql`
          SELECT
            count(DISTINCT s.id)::int AS total,
            count(DISTINCT mk.street_id) FILTER (WHERE mk.done)::int AS done
          FROM settlements st
          JOIN streets s
            ON s.lat BETWEEN st.lat - ${CITY_PAD} AND st.lat + ${CITY_PAD}
           AND s.lng BETWEEN st.lng - ${CITY_PAD} AND st.lng + ${CITY_PAD}
          LEFT JOIN street_marks mk
            ON mk.street_id = s.id AND mk.user_id = ${c.id} AND mk.done
          WHERE st.name_he = ANY(${cityList})
        `) as { total: number; done: number }[];
        const total = row?.total ?? 0;
        const done = row?.done ?? 0;
        progress = {
          done,
          total,
          pct: total > 0 ? Math.round((100 * done) / total) : 0,
        };
      }
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
