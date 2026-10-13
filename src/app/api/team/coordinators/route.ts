import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import {
  ashkolStreetStats,
  clusterIsDone,
  opsDoneAshkols,
} from "@/lib/cluster-status";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

/**
 * רכז על / מנהל: coordinators under the viewer (or all for admin),
 * with cluster progress (ops בוצע, or every street done).
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
    const stats = await ashkolStreetStats(sql, ashkols);
    const opsDone = await opsDoneAshkols(sql, ashkols);
    const doneClusters = ashkols
      .filter((ashkol) =>
        clusterIsDone(stats.get(ashkol)?.done ?? false, opsDone, ashkol),
      )
      .map((ashkol) => {
        const row = clusters.find((item) => item.ashkol === ashkol);
        const st = stats.get(ashkol);
        return {
          ashkol,
          settlement_name: row?.settlement_name ?? "",
          street_total: st?.street_total ?? 0,
          street_done: st?.street_done ?? 0,
        };
      });
    const progress = {
      done: doneClusters.length,
      total: ashkols.length,
      pct:
        ashkols.length > 0
          ? Math.round((100 * doneClusters.length) / ashkols.length)
          : 0,
    };

    out.push({
      ...c,
      institutions,
      clusters,
      cluster_count: clusters.length,
      progress,
      done_clusters: doneClusters,
    });
  }

  return NextResponse.json({ coordinators: out });
}
