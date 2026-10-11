import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { coordinatorInstitutionCities } from "@/lib/streets-access";

export const runtime = "nodejs";

const CITY_PAD = 0.08;

/**
 * רכז על / מנהל: coordinators under the viewer (or all for admin),
 * with street progress and fully-done ashkols.
 */
export async function GET() {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sql = getSql();
  const coords =
    user!.role === "super_admin"
      ? ((await sql`
          SELECT u.id, u.full_name, u.email, u.mobile, u.settlement_name,
                 u.manager_id, m.full_name AS manager_name
          FROM users u
          LEFT JOIN users m ON m.id = u.manager_id
          WHERE u.role = 'coordinator'
          ORDER BY u.full_name
        `) as {
          id: number;
          full_name: string;
          email: string;
          mobile: string | null;
          settlement_name: string | null;
          manager_id: number | null;
          manager_name: string | null;
        }[])
      : ((await sql`
          SELECT u.id, u.full_name, u.email, u.mobile, u.settlement_name,
                 u.manager_id, NULL::text AS manager_name
          FROM users u
          WHERE u.role = 'coordinator' AND u.manager_id = ${user!.id}
          ORDER BY u.full_name
        `) as {
          id: number;
          full_name: string;
          email: string;
          mobile: string | null;
          settlement_name: string | null;
          manager_id: number | null;
          manager_name: string | null;
        }[]);

  const out = [];
  for (const c of coords) {
    const institutions = (await sql`
      SELECT i.id, i.name, i.settlement_name
      FROM institution_coordinators link
      JOIN institutions i ON i.id = link.institution_id
      WHERE link.user_id = ${c.id}
      ORDER BY i.name
    `) as { id: number; name: string; settlement_name: string | null }[];

    const cityList = await coordinatorInstitutionCities(sql, c.id);
    let progress = { done: 0, total: 0 };
    if (cityList.length > 0) {
      const [row] = (await sql`
        SELECT
          count(DISTINCT s.id)::int AS total,
          count(DISTINCT m.street_id) FILTER (WHERE m.done)::int AS done
        FROM settlements st
        JOIN streets s
          ON s.lat BETWEEN st.lat - ${CITY_PAD} AND st.lat + ${CITY_PAD}
         AND s.lng BETWEEN st.lng - ${CITY_PAD} AND st.lng + ${CITY_PAD}
        LEFT JOIN street_marks m
          ON m.street_id = s.id AND m.user_id = ${c.id} AND m.done
        WHERE st.name_he = ANY(${cityList})
      `) as { total: number; done: number }[];
      progress = row ?? progress;
    }

    // Ashkols linked to their institutions where every street is marked done by them.
    const doneClusters = (await sql`
      SELECT cl.ashkol, cl.settlement_name,
             count(s.id)::int AS street_total,
             count(m.street_id) FILTER (WHERE m.done)::int AS street_done
      FROM institution_coordinators link
      JOIN institution_clusters ic ON ic.institution_id = link.institution_id
      JOIN clusters cl ON cl.ashkol = ic.ashkol
      JOIN streets s ON s.ashkol = cl.ashkol
      LEFT JOIN street_marks m
        ON m.street_id = s.id AND m.user_id = ${c.id} AND m.done
      WHERE link.user_id = ${c.id}
      GROUP BY cl.ashkol, cl.settlement_name
      HAVING count(s.id) > 0
         AND count(s.id) = count(m.street_id) FILTER (WHERE m.done)
      ORDER BY cl.settlement_name, cl.ashkol
    `) as {
      ashkol: string;
      settlement_name: string;
      street_total: number;
      street_done: number;
    }[];

    const pct =
      progress.total > 0
        ? Math.round((100 * progress.done) / progress.total)
        : 0;

    out.push({
      ...c,
      institutions,
      progress: { ...progress, pct },
      done_clusters: doneClusters,
    });
  }

  return NextResponse.json({ coordinators: out });
}
