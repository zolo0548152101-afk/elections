import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { ashkolStreetStats } from "@/lib/cluster-status";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

type Row = {
  ashkol: string;
  settlement_name: string;
  institution_id: number;
  institution_name: string;
  coordinator_names: string;
};

/**
 * Admin / רכז על: ashkols already linked to an institution (and optionally done),
 * with institution + coordinator names for a compact team table.
 */
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
      ? ((await sql`
          SELECT
            cl.ashkol,
            cl.settlement_name,
            i.id AS institution_id,
            i.name AS institution_name,
            coalesce(
              (
                SELECT string_agg(u.full_name, ' · ' ORDER BY u.full_name)
                FROM institution_coordinators link
                JOIN users u ON u.id = link.user_id AND u.role = 'coordinator'
                WHERE link.institution_id = i.id
              ),
              ''
            ) AS coordinator_names
          FROM institution_clusters ic
          JOIN clusters cl ON cl.ashkol = ic.ashkol
          JOIN institutions i ON i.id = ic.institution_id
          ORDER BY cl.settlement_name, cl.ashkol, i.name
        `) as Row[])
      : ((await sql`
          SELECT
            cl.ashkol,
            cl.settlement_name,
            i.id AS institution_id,
            i.name AS institution_name,
            coalesce(
              (
                SELECT string_agg(u.full_name, ' · ' ORDER BY u.full_name)
                FROM institution_coordinators link
                JOIN users u ON u.id = link.user_id
                  AND u.role = 'coordinator'
                  AND u.manager_id = ${user!.id}
                WHERE link.institution_id = i.id
              ),
              ''
            ) AS coordinator_names
          FROM institution_clusters ic
          JOIN clusters cl ON cl.ashkol = ic.ashkol
          JOIN institutions i ON i.id = ic.institution_id
          WHERE EXISTS (
            SELECT 1
            FROM institution_coordinators link
            JOIN users u ON u.id = link.user_id
              AND u.role = 'coordinator'
              AND u.manager_id = ${user!.id}
            WHERE link.institution_id = i.id
          )
          ORDER BY cl.settlement_name, cl.ashkol, i.name
        `) as Row[]);

  const stats = await ashkolStreetStats(
    sql,
    rows.map((r) => r.ashkol),
  );

  const clusters = rows.map((r) => ({
    ashkol: r.ashkol,
    settlement_name: r.settlement_name,
    institution_id: r.institution_id,
    institution_name: r.institution_name,
    coordinator_names: r.coordinator_names,
    done: stats.get(r.ashkol)?.done ?? false,
  }));

  return NextResponse.json({ clusters });
}
